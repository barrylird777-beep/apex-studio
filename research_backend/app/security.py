from datetime import datetime, timedelta, timezone
from jose import jwt
from passlib.context import CryptContext
from cryptography.fernet import Fernet
from fastapi import Depends, HTTPException, Request
from .config import settings

pwd=CryptContext(schemes=["bcrypt"],deprecated="auto")
fernet=Fernet(settings.source_encryption_key.encode())

def hash_password(value:str)->str: return pwd.hash(value)
def verify_password(value:str,hashed:str)->bool: return pwd.verify(value,hashed)
def encrypt_source(value:str)->str: return fernet.encrypt(value.encode()).decode()
def decrypt_source(value:str)->str: return fernet.decrypt(value.encode()).decode()

def create_access_token(subject:str,role:str):
    exp=datetime.now(timezone.utc)+timedelta(minutes=settings.access_token_minutes)
    return jwt.encode({"sub":subject,"role":role,"exp":exp},settings.jwt_secret,algorithm=settings.jwt_algorithm)

async def current_claims(request:Request):
    auth=request.headers.get("Authorization","")
    if not auth.startswith("Bearer "): raise HTTPException(status_code=401,detail="Authentication required")
    try: return jwt.decode(auth[7:],settings.jwt_secret,algorithms=[settings.jwt_algorithm])
    except Exception: raise HTTPException(status_code=401,detail="Invalid token")

def require_role(*allowed:str):
    async def dep(claims=Depends(current_claims)):
        if claims.get("role") not in allowed: raise HTTPException(status_code=403,detail="Insufficient role")
        return claims
    return dep
