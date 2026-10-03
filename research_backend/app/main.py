from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from jose import jwt
from fastapi.responses import JSONResponse

from .config import settings
from .routers import api
app=FastAPI(title="APEX Research & FOIA API",version="1.0.0")
app.add_middleware(CORSMiddleware,allow_origins=[x.strip() for x in settings.cors_origins.split(",")],allow_credentials=True,allow_methods=["*"],allow_headers=["*"])
@app.middleware("http")
async def auth_boundary(request,call_next):
 path=request.url.path
 if path.startswith("/api/") and path not in {"/api/auth/token","/api/health"}:
  auth=request.headers.get("Authorization","")
  if not auth.startswith("Bearer "):
   return JSONResponse({"detail":"Authentication required"},status_code=401)
  try:
   jwt.decode(auth[7:],settings.jwt_secret,algorithms=[settings.jwt_algorithm])
  except Exception:
   return JSONResponse({"detail":"Invalid token"},status_code=401)
 return await call_next(request)

app.include_router(api)
@app.get("/")
async def root(): return {"service":"APEX Research & FOIA","docs":"/docs"}
