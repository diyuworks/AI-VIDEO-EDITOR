import sys

def refactor():
    with open('frontend/src/pages/ReelGeneratorPage.tsx', 'r', encoding='utf-8') as f:
        content = f.read()

    # The point where the main component returns
    return_marker = '  return (\n    <div className="w-full max-w-5xl mx-auto'

    # The modal block start and end
    modal_start_marker = '      {/* ===== PREMIUM BOUNDARY MARKER MODAL POPUP ===== */}'

    # Extract everything before modal
    if modal_start_marker not in content:
        print('Modal not found')
        sys.exit(1)

    main_content_end = content.find(modal_start_marker)
    main_code = content[:main_content_end].rstrip() + '\n    </div>\n  );\n};\n\nexport default ReelGeneratorPage;\n'

    modal_block = content[content.find(modal_start_marker):content.find('      )}\n    </div>')]

    new_modal_logic = """
  if (activeMarkingClip) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col p-2 sm:p-4 lg:p-6 overflow-y-auto pb-20">
        <div className="w-full max-w-[1600px] mx-auto bg-white p-4 sm:p-6 md:p-8 rounded-[32px] border border-emerald-100 shadow-xl relative text-slate-800 animate-in fade-in zoom-in duration-300">
"""

    inside_modal = modal_block.split('animate-in fade-in zoom-in duration-200">')[1]
    inside_modal = inside_modal.rstrip()

    full_new_modal = new_modal_logic + inside_modal + """
        </div>
      </div>
    );
  }
"""

    # Now construct the final file
    parts = main_code.split(return_marker)
    final_content = parts[0] + full_new_modal + return_marker + parts[1]

    with open('frontend/src/pages/ReelGeneratorPage.tsx', 'w', encoding='utf-8') as f:
        f.write(final_content)
    print('Successfully refactored layout')

refactor()
