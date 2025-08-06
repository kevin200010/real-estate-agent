# from __future__ import annotations

# import base64
# from pathlib import Path

# from fastapi import FastAPI, UploadFile, File, HTTPException
# from fastapi.middleware.cors import CORSMiddleware
# from pydantic import BaseModel

# from property_chatbot import (
#     PropertyRetriever,
#     LLMClient,
#     SonicClient,
#     PropertyChatbot,
# )
# from dotenv import load_dotenv
# load_dotenv()



# app = FastAPI()
# from fastapi.middleware.cors import CORSMiddleware

# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=["http://localhost:8001"],
#     allow_credentials=True,
#     allow_methods=["*"],
#     allow_headers=["*"],
# )


# # Instantiate core components once at startup
# _data_path = Path(__file__).with_name("properties.json")
# _retriever = PropertyRetriever(_data_path)
# _llm = LLMClient()
# _sonic = SonicClient()
# _bot = PropertyChatbot(_retriever, _llm, _sonic)


# class ChatRequest(BaseModel):
#     text: str


# @app.post("/chat")
# async def chat(req: ChatRequest):
#     if not req.text:
#         raise HTTPException(status_code=400, detail="text is required")
#     answer = _bot.ask_text(req.text)
#     return {"answer": answer}


# @app.post("/voice")
# async def voice(file: UploadFile = File(...)):
#     audio_bytes = await file.read()
#     result = _bot.ask_audio(audio_bytes)
#     audio_b64 = base64.b64encode(result["audio"]).decode("utf-8")
#     return {
#         "transcript": result["transcript"],
#         "answer": result["answer"],
#         "audio": audio_b64,
#     }


# if __name__ == "__main__":
#     import uvicorn

#     uvicorn.run(app, host="0.0.0.0", port=8000)


from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from property_chatbot import process_user_query

app = FastAPI()

# CORS setup if needed
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount templates (for index.html)
templates = Jinja2Templates(directory="templates")

@app.get("/", response_class=HTMLResponse)
def read_root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.post("/chat")
async def chat(request: Request):
    data = await request.json()
    user_input = data.get("message", "")
    print(f"Query: {user_input}")
    return await process_user_query(user_input)
