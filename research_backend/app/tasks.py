from celery import Celery
from .config import settings
celery=Celery("apex_research",broker=settings.redis_url,backend=settings.redis_url)

@celery.task
def refresh_agency_metadata():
 import asyncio
 from sqlalchemy import select
 from .db import SessionLocal
 from .models import Agency
 from .connectors import FoiaGovConnector
 async def run():
  payload=await FoiaGovConnector().agencies()
  items=payload.get("data",payload if isinstance(payload,list) else [])
  async with SessionLocal() as db:
   for item in items:
    attrs=item.get("attributes",item)
    name=attrs.get("name") or attrs.get("title") or attrs.get("abbreviation")
    if not name: continue
    row=(await db.execute(select(Agency).where(Agency.name==name))).scalar_one_or_none()
    if not row: row=Agency(name=name); db.add(row)
    row.foia_portal_url=attrs.get("request_form_url") or attrs.get("foia_url") or row.foia_portal_url
    row.contact_email=attrs.get("email") or attrs.get("contact_email") or row.contact_email
   await db.commit()
  return len(items)
 return asyncio.run(run())

@celery.task
def check_foia_deadlines():
 import asyncio,smtplib
 from email.message import EmailMessage
 from datetime import datetime,timezone
 from sqlalchemy import select
 from .db import SessionLocal
 from .models import FoiaRequest
 async def run():
  now=datetime.now(timezone.utc); due=[]
  async with SessionLocal() as db:
   rows=(await db.execute(select(FoiaRequest).where(FoiaRequest.status.in_(["pending","submitted"])).where(FoiaRequest.date_due<now))).scalars().all()
   for row in rows:
    row.status="delayed"; due.append(row.tracking_number or str(row.id))
   await db.commit()
  if due and settings.smtp_host and settings.smtp_from and settings.smtp_to:
   msg=EmailMessage(); msg["Subject"]="APEX FOIA deadline violations"; msg["From"]=settings.smtp_from; msg["To"]=settings.smtp_to
   msg.set_content("Deadline violations detected: "+", ".join(due))
   with smtplib.SMTP(settings.smtp_host,settings.smtp_port,timeout=20) as smtp: smtp.starttls(); smtp.send_message(msg)
  return {"delayed":len(due)}
 return asyncio.run(run())

@celery.task
def process_document(document_id:int):
 return {"document_id":document_id,"status":"queued-for-ocr-and-indexing"}

@celery.task
def monitor_sources():
 return {"scheduled":"source-monitor"}

from celery.schedules import crontab
celery.conf.beat_schedule={
 "monthly-agency-refresh":{"task":"app.tasks.refresh_agency_metadata","schedule":crontab(minute=0,hour=3,day_of_month=1)},
 "daily-foia-deadlines":{"task":"app.tasks.check_foia_deadlines","schedule":crontab(minute=0,hour=8)},
 "hourly-source-monitor":{"task":"app.tasks.monitor_sources","schedule":crontab(minute=15)}
}
