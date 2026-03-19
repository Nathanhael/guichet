-- Migration: Standardize AI Provider and Model for all partners
UPDATE partners 
SET ai_provider = 'ollama', 
    ollama_model = 'translategemma:4b',
    ai_enabled = true;
