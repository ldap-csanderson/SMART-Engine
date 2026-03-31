"""Cloud Run Jobs trigger helper.

Dispatches long-running background tasks to isolated Cloud Run Job executions
so they survive web-server redeployments.

Environment variables (set automatically by Terraform / Cloud Run):
  CLOUD_RUN_JOB_NAME  – fully-qualified job name, e.g.
                         projects/PROJECT/locations/REGION/jobs/gap-analysis-worker
  GCP_PROJECT_ID      – GCP project (fallback if job name not set)

If CLOUD_RUN_JOB_NAME is not set (local dev), the job is run in-process as a
regular background thread so local development still works without GCP.
"""
import json
import os
import threading
from typing import Any, Dict

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

JOB_KEYWORD_REPORT = "keyword_report"
JOB_GAP_ANALYSIS = "gap_analysis"
JOB_FILTER_EXECUTION = "filter_execution"

_JOB_NAME = os.getenv("CLOUD_RUN_JOB_NAME")  # set by Terraform env var on Cloud Run service


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def trigger_job(job_type: str, params: Dict[str, Any]) -> str:
    """
    Trigger a Cloud Run Job execution for the given job_type + params.

    Returns the execution name (Cloud Run) or a thread identifier (local).
    """
    if _JOB_NAME:
        return _trigger_cloud_run_job(job_type, params)
    else:
        return _trigger_local_thread(job_type, params)


# ---------------------------------------------------------------------------
# Cloud Run Jobs dispatch
# ---------------------------------------------------------------------------

def _trigger_cloud_run_job(job_type: str, params: Dict[str, Any]) -> str:
    from google.cloud import run_v2

    client = run_v2.JobsClient()

    # Override the JOB_TYPE and JOB_PARAMS env vars for this execution
    env_overrides = [
        run_v2.EnvVar(name="JOB_TYPE", value=job_type),
        run_v2.EnvVar(name="JOB_PARAMS", value=json.dumps(params)),
    ]

    request = run_v2.RunJobRequest(
        name=_JOB_NAME,
        overrides=run_v2.RunJobRequest.Overrides(
            container_overrides=[
                run_v2.RunJobRequest.Overrides.ContainerOverride(
                    env=env_overrides,
                )
            ]
        ),
    )

    operation = client.run_job(request=request)
    # Don't wait for completion — fire and forget
    execution_name = operation.metadata.name if operation.metadata else _JOB_NAME
    print(f"🚀 Triggered Cloud Run Job execution: {execution_name} (type={job_type})")
    return execution_name


# ---------------------------------------------------------------------------
# Local fallback: run in a background thread
# ---------------------------------------------------------------------------

def _trigger_local_thread(job_type: str, params: Dict[str, Any]) -> str:
    """Run the job synchronously in a daemon thread (local dev only)."""
    def _run():
        _dispatch(job_type, params)

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    thread_id = str(t.ident)
    print(f"🧵 Started local background thread for job_type={job_type} (thread={thread_id})")
    return thread_id


# ---------------------------------------------------------------------------
# Dispatcher (used by both worker.py and local thread fallback)
# ---------------------------------------------------------------------------

def _dispatch(job_type: str, params: Dict[str, Any]):
    """Route job_type to the appropriate pipeline function."""
    if job_type == JOB_KEYWORD_REPORT:
        _run_keyword_report(params)
    elif job_type == JOB_GAP_ANALYSIS:
        _run_gap_analysis(params)
    elif job_type == JOB_FILTER_EXECUTION:
        _run_filter_execution(params)
    else:
        raise ValueError(f"Unknown job_type: {job_type!r}")


# ---------------------------------------------------------------------------
# Job implementations (imported lazily to avoid circular imports)
# ---------------------------------------------------------------------------

def _run_keyword_report(params: Dict[str, Any]):
    from routers.keyword_reports import _process_report_background
    _process_report_background(
        report_id=params["report_id"],
        urls=params["urls"],
    )


def _run_gap_analysis(params: Dict[str, Any]):
    from routers.gap_analysis import _run_analysis_background
    _run_analysis_background(
        analysis_id=params["analysis_id"],
        report_id=params["report_id"],
        portfolio_id=params["portfolio_id"],
        filter_ids=params.get("filter_ids"),
        min_monthly_searches=params.get("min_monthly_searches", 1000),
    )


def _run_filter_execution(params: Dict[str, Any]):
    from routers.filter_executions import _run_filter_background
    _run_filter_background(
        execution_id=params["execution_id"],
        analysis_id=params["analysis_id"],
        filter_snapshot=params["filter_snapshot"],
    )
