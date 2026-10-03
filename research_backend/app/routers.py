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

@api.get("/connectors/{provider}")
async def connector_search(provider:str,q:str):
 from .connectors import CongressConnector,CourtListenerConnector,InternetArchiveConnector,MuckRockConnector,DocumentCloudConnector
 connectors={"congress":CongressConnector(),"courtlistener":CourtListenerConnector(),"internet_archive":InternetArchiveConnector(),"muckrock":MuckRockConnector(),"documentcloud":DocumentCloudConnector()}
 if provider not in connectors: raise HTTPException(404,"Connector not configured")
 return await connectors[provider].search(q)

@api.get("/requests/deadlines")
async def request_deadlines(db:AsyncSession=Depends(get_db)):
 from datetime import datetime,timezone
 rows=(await db.execute(select(FoiaRequest).where(FoiaRequest.status.in_(["pending","submitted","delayed"])).order_by(FoiaRequest.date_due))).scalars().all()
 now=datetime.now(timezone.utc)
 return [{"id":r.id,"tracking_number":r.tracking_number,"agency_id":r.agency_id,"status":r.status,"date_due":r.date_due,"seconds_remaining":None if not r.date_due else int((r.date_due-now).total_seconds())} for r in rows]

TEMPLATES={
 "personnel_records":"Personnel records for {{name}} for {{start_date}} through {{end_date}}.",
 "communication_logs":"Communications between {{name_a}} and {{name_b}} from {{start_date}} through {{end_date}}.",
 "budget_expenditures":"Budget and expenditure records for {{program}} for fiscal years {{start_year}} through {{end_year}}.",
 "policy_directives":"Policy directives, memoranda, and guidance concerning {{subject}} from {{start_date}} through {{end_date}}.",
 "incident_reports":"Incident reports concerning {{case_number}} involving {{name}} during {{start_date}} through {{end_date}}."
}
@api.get("/request-templates")
async def request_templates(): return TEMPLATES

@api.post("/request-templates/render")
async def render_request_template(payload:dict):
 import re
 kind=payload.get("kind")
 if kind not in TEMPLATES: raise HTTPException(404,"Unknown template")
 text=TEMPLATES[kind]
 return {"kind":kind,"text":re.sub(r"{{\s*([\w_]+)\s*}}",lambda m:str(payload.get("variables",{}).get(m.group(1),m.group(0))),text)}

@api.get("/health")
async def health(): return {"ok":True,"service":"apex-research"}
