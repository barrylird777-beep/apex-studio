def appeal_template(request:dict)->str:
 return f"""Subject: Appeal of FOIA Request {request.get("tracking_number","")}
I am appealing the determination/status of the above request. Please identify the applicable statutory basis for each withholding or delay, release all reasonably segregable non-exempt material, and provide the agency's appeal instructions and response deadline.
Request text: {request.get("request_text","")}
"""