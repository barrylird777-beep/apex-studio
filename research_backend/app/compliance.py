import ipaddress
from fastapi import HTTPException,Request
from .config import settings

def sensitive_access_guard(request:Request):
 ip=request.client.host if request.client else "0.0.0.0"
 allowed=[ipaddress.ip_network(x.strip()) for x in settings.allowed_sensitive_cidrs.split(",") if x.strip()]
 if not any(ipaddress.ip_address(ip) in net for net in allowed): raise HTTPException(403,"Sensitive investigation access restricted")
 return True
