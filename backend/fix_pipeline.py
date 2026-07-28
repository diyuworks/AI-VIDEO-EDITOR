import os

with open('app/routers/pipeline.py', 'r', encoding='utf-8') as f:
    text = f.read()

old_block = '''    # ---- SUB-STEP A: AI Script Generate Karo ----
    try:
        # Call our actual editing_plan endpoint logic
        plan_req = EditingPlanRequest(
            object_name=request.raw_video_object_name,
            reference_object_name=request.reference_object_name,
            prompt=request.prompt,
            structured_options=request.structured_options
        )
        plan_res = generate_editing_plan(plan_req, session)'''

new_block = '''    # ---- SUB-STEP A: AI Script Generate Karo ----
    try:
        from app.routers.captions import generate_captions
        
        reference_captions = None
        if request.reference_object_name:
            try:
                cap_res = generate_captions(request.reference_object_name, session)
                reference_captions = cap_res.get("captions")
            except Exception as e:
                with open("debug.log", "a", encoding="utf-8") as f: f.write(f"Warning: Failed to fetch reference captions: {str(e)}\\n")

        # Call our actual editing_plan endpoint logic
        plan_req = EditingPlanRequest(
            object_name=request.raw_video_object_name,
            reference_object_name=request.reference_object_name,
            reference_captions=reference_captions,
            prompt=request.prompt,
            structured_options=request.structured_options
        )
        plan_res = generate_editing_plan(plan_req, session)'''

text = text.replace(old_block, new_block)

with open('app/routers/pipeline.py', 'w', encoding='utf-8') as f:
    f.write(text)
