# A2A SQL analyst agent: native a2a-sdk (Starlette) app served by uvicorn,
# running a bounded LangGraph DAG. Reads only via the DB MCP server; mints
# audience-restricted service tokens for its outbound calls.
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install dependencies first for better layer caching. All runtime deps ship
# wheels, so no system build toolchain is required.
COPY pyproject.toml ./
COPY src ./src
RUN pip install .

# Drop privileges: the agent must never run as root.
RUN useradd --create-home --uid 10002 nova
USER nova

EXPOSE 8003

CMD ["uvicorn", "at_sql_analyser.main:app", \
     "--host", "0.0.0.0", "--port", "8003"]
