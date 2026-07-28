import os

with open('src/pages/ReelGeneratorPage.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace(
'''interface ReelGeneratorPageProps {
  rawVideoObjectName: string;
  prompt?: string;
}''',
'''interface ReelGeneratorPageProps {
  rawVideoObjectName: string;
  referenceObjectName?: string | null;
  prompt?: string;
}'''
)

text = text.replace(
'''const ReelGeneratorPage: React.FC<ReelGeneratorPageProps> = ({
  rawVideoObjectName,
  prompt,
}) => {''',
'''const ReelGeneratorPage: React.FC<ReelGeneratorPageProps> = ({
  rawVideoObjectName,
  referenceObjectName,
  prompt,
}) => {'''
)

text = text.replace(
'''          raw_video_object_name: rawVideoObjectName,
          highlighted_video_object_name: overlayData.output_object_name,
          prompt: prompt || "",''',
'''          raw_video_object_name: rawVideoObjectName,
          highlighted_video_object_name: overlayData.output_object_name,
          reference_object_name: referenceObjectName || null,
          prompt: prompt || "",'''
)

with open('src/pages/ReelGeneratorPage.tsx', 'w', encoding='utf-8') as f:
    f.write(text)
