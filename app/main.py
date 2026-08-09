from fastapi import FastAPI, UploadFile, File, Query, HTTPException, Request
from fastapi.responses import StreamingResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

import io
import os
import json
from typing import Optional
import cv2
import numpy as np
from uuid import uuid4
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(dotenv_path=Path(__file__).parent / '.env')

import google.generativeai as genai

from model_loader import load_models
from image_processor import process_image

# load environment variables from .env in app directory 
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
print('DEBUG: GEMINI_API_KEY loaded:', GEMINI_API_KEY)

if not GEMINI_API_KEY:
    raise RuntimeError("Gemini API key not found in environment.")
genai.configure(api_key=GEMINI_API_KEY)

# initializing Gemini model in text-only mode
gemini_model = genai.GenerativeModel('gemini-2.0-flash')
print('DEBUG: Gemini model initialized: gemini-2.0-flash')

# loading YOLO model once at startup
models = load_models()

# fastAPI app
app = FastAPI(
    title="YOLO Detection API",
    description="Upload an image and get YOLO detection results.",
    version="1.0.0",
)

# serve static files 
static_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "static"))
app.mount("/static", StaticFiles(directory=static_dir), name="static")

# jinja2 template engine setup
templates_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "templates"))
templates = Jinja2Templates(directory=templates_dir)


@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    """
    render the main upload form page.
    """
    return templates.TemplateResponse(
        request=request,
        name="index.html"
    )


@app.post("/detect/")
async def detect(file: UploadFile = File(...)):
    """
    detect objects in an uploaded image using YOLO.
    returns both the annotated image and a list of detected object names.
    """
    file_bytes = await file.read()
    filename = file.filename.lower()
    model = next(iter(models.values()))

    if filename.endswith((".jpg", ".jpeg", ".png")):
        try:
            img = cv2.imdecode(np.frombuffer(file_bytes, np.uint8), cv2.IMREAD_COLOR)
            if img is None:
                raise HTTPException(status_code=400, detail="Could not decode image. Please upload a valid image file.")
            results = model(img)
            names = results[0].names if hasattr(results[0], 'names') else []
            detected = [names[int(cls)] for cls in results[0].boxes.cls] if hasattr(results[0], 'boxes') else []
            result_img = results[0].plot()
            _, encoded = cv2.imencode(".jpg", result_img)
            image_bytes = encoded.tobytes()
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid image. {str(e)}")
        return StreamingResponse(io.BytesIO(image_bytes), media_type="image/jpeg", headers={"X-Detected-Objects": ",".join(detected)})

    raise HTTPException(
        status_code=400,
        detail="Unsupported file type. Please upload an image.",
    )


class RecipeRequest(BaseModel):
    items: list[str]


@app.post("/recipe/")
async def generate_recipe(request: RecipeRequest):
    """
    generate a simple recipe using Gemini API based on detected items.
    """
    items = request.items
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="Gemini API key not set.")

    prompt = (
        f"Create a simple, beginner-friendly Indian recipe using these ingredients: {', '.join(items)}. "
        f"List the recipe name, ingredients (as a bullet list), and step-by-step instructions (as a numbered list). "
        f"Do not use markdown, stars, or special characters for formatting. Use plain text with clear section headers. "
        f"Format the output as:\n\nRecipe Name: <name>\n\nIngredients:\n- ingredient1\n- ingredient2\n\nInstructions:\n1. Step one\n2. Step two\n"
    )

    try:
        import asyncio
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, gemini_model.generate_content, prompt)
        recipe = response.text.strip()
        import re
        recipe = re.sub(r'^[*\-]+', '', recipe, flags=re.MULTILINE)  # remove leading stars/dashes
        recipe = re.sub(r'\*', '', recipe)  # remove stray stars
        # Convert plain text recipe to HTML for web display, removing extra blank lines
        html_recipe = recipe
        html_recipe = re.sub(r'^Recipe Name:(.*)$', r'<h2>\1</h2>', html_recipe, flags=re.MULTILINE)
        html_recipe = re.sub(r'^Ingredients:', r'<h3>Ingredients</h3><ul>', html_recipe, flags=re.MULTILINE)
        html_recipe = re.sub(r'^Instructions:', r'</ul><h3>Instructions</h3><ol>', html_recipe, flags=re.MULTILINE)
        html_recipe = re.sub(r'^-\s*(.*)$', r'<li>\1</li>', html_recipe, flags=re.MULTILINE)
        html_recipe = re.sub(r'^\d+\.\s*(.*)$', r'<li>\1</li>', html_recipe, flags=re.MULTILINE)
        if '<ol>' in html_recipe:
            html_recipe += '</ol>'
        html_recipe = html_recipe.replace('<ul></ul>', '')
        # Remove extra blank lines and whitespace between tags
        html_recipe = re.sub(r'\s*([<>])\s*', r'\1', html_recipe)
        html_recipe = re.sub(r'(</[ou]l>|</ol>)(\s*<)', r'\1\2', html_recipe)
        html_recipe = re.sub(r'\n{2,}', '\n', html_recipe)
        html_recipe = html_recipe.strip()
        return {"recipe": recipe, "recipe_html": html_recipe}
    except Exception as e:
        import traceback
        print("Gemini API error:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Gemini error: {str(e)}")
