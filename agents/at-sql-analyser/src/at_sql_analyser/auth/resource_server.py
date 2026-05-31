"""Inbound resource-server authentication for the agent's A2A surface.

Validates the caller's audience-restricted token (signature via JWKS, issuer,
``aud: nova-agent-sql-analyst``, ``exp``) and pins the authorized party
(``azp``) to the Celery worker — the ONLY client allowed to task this agent.
Default deny: any failure raises and the request is rejected. Mirrors the
orchestrator gateway's PyJWT pattern, hardened with `azp` pinning.
"""

from __future__ import annotations

from dataclasses import dataclass

import jwt
from jwt import PyJWKClient

_ALLOWED_ALGS = ["RS256", "ES256"]


@dataclass(frozen=True)
class VerifiedCaller:
    azp: str
    subject: str


class AuthError(Exception):
    """Raised when an inbound token is missing, invalid, or unauthorized."""


class ResourceServer:
    def __init__(
        self,
        *,
        jwks_uri: str,
        issuer_url: str,
        audience: str,
        authorized_parties: tuple[str, ...],
    ) -> None:
        self._jwks_client = PyJWKClient(jwks_uri)
        self._issuer = issuer_url
        self._audience = audience
        self._authorized_parties = set(authorized_parties)

    def verify(self, authorization_header: str) -> VerifiedCaller:
        if not authorization_header.startswith("Bearer "):
            raise AuthError("bearer token required")
        token = authorization_header.removeprefix("Bearer ").strip()
        if not token:
            raise AuthError("bearer token required")
        try:
            signing_key = self._jwks_client.get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=_ALLOWED_ALGS,
                audience=self._audience,
                issuer=self._issuer,
                options={"require": ["exp", "iss", "aud"]},
            )
        except jwt.PyJWTError as exc:
            raise AuthError("invalid service token") from exc

        azp = claims.get("azp")
        if not isinstance(azp, str) or azp not in self._authorized_parties:
            raise AuthError("token issued to an unauthorized party")
        subject = claims.get("sub")
        return VerifiedCaller(azp=azp, subject=str(subject) if subject else azp)
