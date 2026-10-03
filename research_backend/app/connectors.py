import httpx
from .config import settings

class CongressConnector:
 async def search(self,query:str):
  headers={"X-Api-Key":settings.congress_api_key} if settings.congress_api_key else {}
  async with httpx.AsyncClient(timeout=20) as client:
   r=await client.get("https://api.congress.gov/v3/bill",params={"format":"json","query":query},headers=headers); r.raise_for_status(); return r.json()

class CourtListenerConnector:
 async def search(self,query:str):
  headers={"Authorization":f"Token {settings.courtlistener_api_key}"} if settings.courtlistener_api_key else {}
  async with httpx.AsyncClient(timeout=20) as client:
   r=await client.get("https://www.courtlistener.com/api/rest/v3/search/",params={"q":query},headers=headers); r.raise_for_status(); return r.json()

class InternetArchiveConnector:
 async def search(self,query:str):
  async with httpx.AsyncClient(timeout=20) as client:
   r=await client.get(f"{settings.internet_archive_url.rstrip('/')}/advancedsearch.php",params={"q":query,"output":"json"}); r.raise_for_status(); return r.json()

class MuckRockConnector:
 async def search(self,query:str):
  if not settings.muckrock_api_url: return {"configured":False,"results":[]}
  async with httpx.AsyncClient(timeout=20) as client:
   r=await client.get(settings.muckrock_api_url,params={"q":query}); r.raise_for_status(); return r.json()

class DocumentCloudConnector:
 async def search(self,query:str):
  if not settings.documentcloud_api_url: return {"configured":False,"results":[]}
  headers={"Authorization":f"Bearer {settings.documentcloud_api_key}"} if settings.documentcloud_api_key else {}
  async with httpx.AsyncClient(timeout=20) as client:
   r=await client.get(settings.documentcloud_api_url,params={"q":query},headers=headers); r.raise_for_status(); return r.json()
