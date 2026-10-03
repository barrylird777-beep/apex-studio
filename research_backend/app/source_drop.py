from .config import settings

def secure_drop_status():
 return {"configured":bool(settings.secure_drop_url),"endpoint":settings.secure_drop_url}

def create_drop_request(label:str):
 if not settings.secure_drop_url: return {"configured":False}
 return {"configured":True,"label":label,"endpoint":settings.secure_drop_url}
