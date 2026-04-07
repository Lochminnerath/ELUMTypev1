"""Netlify Function entrypoint for the FastAPI app."""

from mangum import Mangum

from app import app

# Exposed for Netlify/AWS Lambda compatibility.
handler = Mangum(app)
