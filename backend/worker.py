"""Cloud Run Job worker entrypoint.

Reads JOB_TYPE and JOB_PARAMS from environment variables and dispatches
to the appropriate pipeline function.

Usage (set by Cloud Run Jobs via env overrides):
  JOB_TYPE   = "keyword_report" | "gap_analysis" | "filter_execution"
  JOB_PARAMS = JSON-encoded dict of parameters for the job

Example:
  JOB_TYPE=keyword_report
  JOB_PARAMS={"report_id": "abc123", "urls": ["https://example.com"]}
"""
import json
import os
import sys


def main():
    job_type = os.environ.get("JOB_TYPE")
    job_params_raw = os.environ.get("JOB_PARAMS", "{}")

    if not job_type:
        print("❌ JOB_TYPE environment variable is required", file=sys.stderr)
        sys.exit(1)

    try:
        params = json.loads(job_params_raw)
    except json.JSONDecodeError as e:
        print(f"❌ Failed to parse JOB_PARAMS: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"🚀 Worker starting: job_type={job_type}")
    print(f"   params={json.dumps(params, indent=2)}")

    # Import dispatch function from jobs module
    from jobs import _dispatch
    try:
        _dispatch(job_type, params)
        print(f"✅ Worker completed: job_type={job_type}")
    except Exception as e:
        print(f"❌ Worker failed: job_type={job_type}, error={e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
