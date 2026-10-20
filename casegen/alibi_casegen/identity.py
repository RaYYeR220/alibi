"""Venice key retrieval through AgentCore Identity (API-key credential provider "venice").

The pipeline runs on Lambda, so it authenticates as the "alibi-casegen" workload
identity and reads the key from the AgentCore token vault; nothing is stored in
the function's configuration.
"""

from __future__ import annotations

import asyncio
import os

from bedrock_agentcore.services.identity import IdentityClient

PROVIDER = "venice"


def venice_key_from_identity() -> str:
    region = os.environ.get("AWS_REGION", "us-east-1")
    workload = os.environ.get("ALIBI_WORKLOAD", "alibi-casegen")
    client = IdentityClient(region)
    token = client.get_workload_access_token(workload)["workloadAccessToken"]
    return asyncio.run(client.get_api_key(provider_name=PROVIDER, agent_identity_token=token))
