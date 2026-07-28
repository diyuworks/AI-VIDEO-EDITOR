import os

with open('app/routers/pipeline.py', 'r', encoding='utf-8') as f:
    text = f.read()

old_block = '''    except Exception as e:
        with open("debug.log", "a") as f: f.write(f"TTS Error: {str(e)}\\n")'''

new_block = '''    except Exception as e:
        with open("debug.log", "a", encoding="utf-8") as f: f.write(f"TTS Error: {str(e)} | Script: {generated_script}\\n")'''

text = text.replace(old_block, new_block)

with open('app/routers/pipeline.py', 'w', encoding='utf-8') as f:
    f.write(text)
