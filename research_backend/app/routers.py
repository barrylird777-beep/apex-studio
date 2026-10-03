from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from .db import get_db
from .models import Agency,FoiaRequest,Document,Source,Investigation,User
from .schemas import *
from .security import *

api=APIRouter(prefix="/api")

@api.post("/auth/token",response_model=Token)
async def token(user:UserCreate,db:AsyncSession=Depends(get_db)):
 row=(await db.execute(select(User).where(User.email==user.email))).scalar_one_or_none()
 if not row or not verify_password(user.password,row.password_hash): raise HTTPException(401,"Invalid credentials")
 return Token(access_token=create_access_token(str(row.id),row.role))

@api.post("/users",dependencies=[Depends(require_role("admin"))])
async def create_user(user:UserCreate,db:AsyncSession=Depends(get_db)):
 row=User(email=user.email,password_hash=hash_password(user.password),role=user.role,institutional_affiliation=user.institutional_affiliation)
 db.add(row); await db.commit(); await db.refresh(row)
 return {"id":row.id,"email":row.email,"role":row.role}

@api.get("/agencies")
async def agencies(db:AsyncSession=Depends(get_db)): return (await db.execute(select(Agency).order_by(Agency.name))).scalars().all()

@api.post("/agencies",dependencies=[Depends(require_role("editor","admin"))])
async def create_agency(data:AgencyCreate,db:AsyncSession=Depends(get_db)):
 row=Agency(**data.model_dump()); db.add(row); await db.commit(); await db.refresh(row); return row

@api.get("/requests")
async def requests(db:AsyncSession=Depends(get_db)): return (await db.execute(select(FoiaRequest).order_by(FoiaRequest.date_due))).scalars().all()

@api.post("/requests",dependencies=[Depends(require_role("researcher","editor","admin"))])
async def create_request(data:RequestCreate,db:AsyncSession=Depends(get_db)):
 row=FoiaRequest(**data.model_dump(),status="pending"); db.add(row); await db.commit(); await db.refresh(row); return row

@api.get("/documents")
async def documents(db:AsyncSession=Depends(get_db)): return (await db.execute(select(Document).order_by(Document.id.desc()))).scalars().all()

@api.post("/documents",dependencies=[Depends(require_role("editor","admin"))])
async def create_document(data:DocumentCreate,db:AsyncSession=Depends(get_db)):
 row=Document(**data.model_dump()); db.add(row); await db.commit(); await db.refresh(row); return row

@api.get("/sources")
async def sources(db:AsyncSession=Depends(get_db)):
 rows=(await db.execute(select(Source).order_by(Source.name))).scalars().all()
 return [{"id":r.id,"name":r.name,"type":r.type,"reliability_rating":r.reliability_rating,"relationship_notes":r.relationship_notes} for r in rows]

@api.post("/sources",dependencies=[Depends(require_role("editor","admin"))])
async def create_source(data:SourceCreate,db:AsyncSession=Depends(get_db)):
 row=Source(name=data.name,type=data.type,encrypted_contact_info=encrypt_source(data.contact_info) if data.contact_info else None,reliability_rating=data.reliability_rating,relationship_notes=data.relationship_notes)
 db.add(row); await db.commit(); await db.refresh(row); return {"id":row.id,"name":row.name}

@api.get("/investigations")
async def investigations(db:AsyncSession=Depends(get_db)): return (await db.execute(select(Investigation).order_by(Investigation.id.desc()))).scalars().all()

@api.post("/investigations",dependencies=[Depends(require_role("editor","admin"))])
async def create_investigation(data:InvestigationCreate,db:AsyncSession=Depends(get_db)):
 row=Investigation(title=data.title,description=data.description,status=data.status); db.add(row); await db.commit(); await db.refresh(row); return row

@api.get("/dashboard")
async def dashboard(db:AsyncSession=Depends(get_db)):
 return {"pending_requests":await db.scalar(select(func.count()).select_from(FoiaRequest).where(FoiaRequest.status.in_(["pending","submitted","delayed"]))),"documents":await db.scalar(select(func.count()).select_from(Document)),"investigations":await db.scalar(select(func.count()).select_from(Investigation)),"sources":await db.scalar(select(func.count()).select_from(Source))}

@api.get("/health")
async def health(): return {"ok":True,"service":"apex-research"}
