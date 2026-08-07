import ffmpeg
import os

clip_specs = [
    {'file': 'backend/demo_clips/Demo_Clip_1.mp4', 't': 3.20},
    {'file': 'backend/demo_clips/Demo_Clip_2.mp4', 't': 4.40},
    {'file': 'backend/demo_clips/Demo_Clip_3.mp4', 't': 6.60},
    {'file': 'backend/demo_clips/Demo_Clip_4.mp4', 't': 3.80},
    {'file': 'backend/demo_clips/Demo_Clip_5.mp4', 't': 11.80}
]

processed_clips = []
for idx, spec in enumerate(clip_specs):
    p = spec['file']
    t_cut = spec['t']
    out_p = f'backend/demo_clips/perfect_clip_{idx+1}.mp4'
    
    vid = (
        ffmpeg.input(p, ss=0, t=t_cut).video
        .filter('fps', fps=25)
        .filter('scale', 720, 1280, force_original_aspect_ratio='decrease')
        .filter('pad', 720, 1280, '(ow-iw)/2', '(oh-ih)/2')
        .filter('setsar', '1')
        .filter('format', 'yuv420p')
    )
    
    aud = ffmpeg.input('anullsrc=r=44100:cl=stereo', f='lavfi', t=t_cut).audio
    out = ffmpeg.output(vid, aud, out_p, vcodec='libx264', acodec='aac', shortest=None)
    ffmpeg.run(out, overwrite_output=True)
    processed_clips.append(out_p)

concat_txt = 'backend/demo_clips/concat_perfect.txt'
with open(concat_txt, 'w') as f:
    for cp in processed_clips:
        f.write(f"file '{os.path.abspath(cp)}'\n")

merged_video = 'backend/demo_clips/perfect_synced_video.mp4'
cmd_concat = f'ffmpeg -y -f concat -safe 0 -i "{concat_txt}" -c copy "{merged_video}"'
os.system(cmd_concat)

audio_in = r'c:\Users\Diya Malvia\Downloads\AUDIO.mpeg'
final_reel = 'backend/demo_clips/Generated_Reel_PERFECT_SYNCED.mp4'

v = ffmpeg.input(merged_video).video
a = ffmpeg.input(audio_in).audio

out_final = ffmpeg.output(v, a, final_reel, vcodec='libx264', acodec='aac', shortest=None)
ffmpeg.run(out_final, overwrite_output=True)

print("SUCCESS! Frame-perfect scene-synced AI reel generated!")
print("Final Reel Path:", os.path.abspath(final_reel))
print("File Size:", os.path.getsize(final_reel) / (1024*1024), "MB")
