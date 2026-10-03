import asyncio,os
from app.db import SessionLocal
from app.models import User
from app.security import hash_password
async def main():
 email=os.environ["APEX_ADMIN_EMAIL"]; password=os.environ["APEX_ADMIN_PASSWORD"]
 async with SessionLocal() as db:
  db.add(User(email=email,password_hash=hash_password(password),role="admin",institutional_affiliation=os.getenv("APEX_ADMIN_AFFILIATION")))
  await db.commit()
if __name__=="__main__": asyncio.run(main())
