# Multi-stage build: Build React frontend + Python backend in single container
# Build from project root, not from backend/

FROM node:20-slim AS frontend-builder

WORKDIR /frontend

# Brand name injected at build time via deploy.sh --substitutions
# Vite embeds VITE_* env vars into the bundle at build time.
ARG VITE_BRAND_NAME="SMART Engine"
ENV VITE_BRAND_NAME=$VITE_BRAND_NAME

# Copy frontend package files
COPY frontend/package*.json ./
RUN npm ci

# Copy frontend source
COPY frontend/ ./

# Build React app (outputs to /frontend/dist)
RUN npm run build


# Final stage: Python backend with built frontend
FROM python:3.11-slim

WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application code
COPY backend/ .

# Copy built frontend from previous stage
COPY --from=frontend-builder /frontend/dist ./static

# Port will be provided by Cloud Run via $PORT env variable
ENV PORT=8000

# Run the application
CMD uvicorn api:app --host 0.0.0.0 --port $PORT
