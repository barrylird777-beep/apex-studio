from elasticsearch import AsyncElasticsearch
from .config import settings
client=AsyncElasticsearch(settings.elasticsearch_url)
async def index_document(document_id:int,text:str,metadata:dict):
 await client.index(index="apex-documents",id=document_id,document={"text":text,**metadata})
async def search_documents(query:str,size:int=50):
 result=await client.search(index="apex-documents",query={"multi_match":{"query":query,"fields":["text"]}},size=size)
 return result["hits"]["hits"]
