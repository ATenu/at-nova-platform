# Single image for both roles: the FastAPI task gateway (default CMD) and the
# Celery worker (command overridden in docker-compose). Keeping one image keeps
# the authz/snapshot parity code byte-identical across both processes.
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install dependencies first for better layer caching. psycopg[binary] and
# uvicorn[standard] ship wheels, so no system build toolchain is required.
COPY pyproject.toml ./
COPY src ./src
RUN pip install .

# Drop privileges: the execution plane must never run as root.
RUN useradd --create-home --uid 10001 nova
USER nova

EXPOSE 8001

# Default role: the task gateway. The worker service overrides `command`.
CMD ["uvicorn", "nova_orchestrator.gateway:create_app", "--factory", \
     "--host", "0.0.0.0", "--port", "8001"]
