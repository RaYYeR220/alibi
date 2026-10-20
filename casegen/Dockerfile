FROM ghcr.io/astral-sh/uv:python3.12-trixie-slim
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY config.json ./
COPY alibi_casegen ./alibi_casegen
RUN uv sync --frozen --no-dev
ENV AGENTCORE_RUNTIME=1 PATH="/app/.venv/bin:$PATH"
EXPOSE 8080
CMD ["python", "-m", "alibi_casegen.agentcore_app"]
