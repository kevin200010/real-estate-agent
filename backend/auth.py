import os
from typing import Any, Dict, Optional

import requests
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
try:  # pragma: no cover - allow running without dependency
    from jose import jwk, jwt
    from jose.utils import base64url_decode
except Exception:  # pragma: no cover
    jwk = jwt = None  # type: ignore
    base64url_decode = None  # type: ignore

_region = os.getenv("COGNITO_REGION")
_user_pool_id = os.getenv("COGNITO_USER_POOL_ID")
_issuer: Optional[str] = None
_jwks: Optional[Dict[str, Any]] = None

if _region and _user_pool_id:
    _issuer = f"https://cognito-idp.{_region}.amazonaws.com/{_user_pool_id}"
    try:
        _jwks = requests.get(f"{_issuer}/.well-known/jwks.json").json()
    except Exception:
        _jwks = None

_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_scheme),
) -> Optional[Dict[str, Any]]:
    """Validate a Cognito JWT and return its claims.

    When Cognito configuration is missing, authentication is skipped to
    allow local development and tests.
    """
    if not _issuer or not _jwks or jwk is None or jwt is None:
        return None
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = credentials.credentials
    headers = jwt.get_unverified_header(token)
    kid = headers.get("kid")
    key = next((k for k in _jwks.get("keys", []) if k.get("kid") == kid), None)
    if not key:
        raise HTTPException(status_code=401, detail="Invalid token")
    public_key = jwk.construct(key)
    message, encoded_sig = token.rsplit(".", 1)
    decoded_sig = base64url_decode(encoded_sig.encode())
    if not public_key.verify(message.encode(), decoded_sig):
        raise HTTPException(status_code=401, detail="Signature verification failed")
    claims = jwt.get_unverified_claims(token)
    if claims.get("iss") != _issuer:
        raise HTTPException(status_code=401, detail="Invalid issuer")
    if claims.get("token_use") not in {"id", "access"}:
        raise HTTPException(status_code=401, detail="Invalid token use")
    return claims
