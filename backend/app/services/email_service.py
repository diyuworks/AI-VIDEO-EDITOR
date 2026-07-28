import os
import smtplib
import threading
import time
from datetime import datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import app.config as cfg

# Simple cache to prevent spam (5 min cooldown)
_visit_cooldowns = {}

def _send_email_worker(subject: str, html_content: str, text_content: str):
    """
    Internal worker function that runs in a background thread to send SMTP email.
    Does not block the main FastAPI request thread.
    """
    if not cfg.ENABLE_EMAIL_NOTIFICATIONS:
        print("Notice: Email notifications are disabled.")
        return

    if not cfg.NOTIFICATION_EMAIL_TO or not cfg.SMTP_USER or not cfg.SMTP_PASSWORD:
        print("Notice: Email settings incomplete (SMTP_USER, SMTP_PASSWORD, NOTIFICATION_EMAIL_TO). Logged alert instead:")
        print(f"  [EMAIL ALERT] {subject}\n  {text_content}")
        return

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"🔔 [Jamin24 AI Alert] {subject}"
        msg["From"] = f"Jamin24 AI Hub <{cfg.SMTP_USER}>"
        msg["To"] = cfg.NOTIFICATION_EMAIL_TO

        part1 = MIMEText(text_content, "plain")
        part2 = MIMEText(html_content, "html")

        msg.attach(part1)
        msg.attach(part2)

        with smtplib.SMTP(cfg.SMTP_SERVER, cfg.SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(cfg.SMTP_USER, cfg.SMTP_PASSWORD)
            server.sendmail(cfg.SMTP_USER, cfg.NOTIFICATION_EMAIL_TO, msg.as_string())

        print(f"Success: Email notification sent to {cfg.NOTIFICATION_EMAIL_TO}: {subject}")
    except Exception as e:
        print(f"Warning: Failed to send email alert ({subject}): {e}")


def send_email_async(subject: str, html_content: str, text_content: str):
    """
    Spawns a background thread to send email without blocking the API call.
    """
    thread = threading.Thread(
        target=_send_email_worker,
        args=(subject, html_content, text_content),
        daemon=True
    )
    thread.start()


def notify_website_visit(client_ip: str = "Unknown", user_agent: str = "Unknown"):
    """Triggered when someone opens the website."""
    if client_ip != "Unknown":
        now = time.time()
        last_visit = _visit_cooldowns.get(client_ip, 0)
        if now - last_visit < 300:
            print(f"Notice: Suppressed duplicate website visit notification for IP {client_ip} (cooldown active)")
            return
        _visit_cooldowns[client_ip] = now

    now_str = datetime.now().strftime("%d %B %Y, %I:%M:%S %p")
    subject = "Website Opened / New Visitor Active!"
    
    text_content = f"Someone opened Jamin24 AI Video HUB!\nTime: {now_str}\nIP: {client_ip}\nUser-Agent: {user_agent}"
    
    html_content = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px;">
        <div style="background-color: #0D473B; padding: 15px; text-align: center; border-radius: 10px;">
            <h2 style="color: #ffffff; margin: 0;">🧭 Jamin24 AI Video HUB</h2>
        </div>
        <div style="padding: 20px; color: #1e293b;">
            <h3 style="color: #0D473B;">🔔 Website Opened Alert!</h3>
            <p>Someone just visited your <b>Jamin24 AI Video HUB</b> website.</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                <tr><td style="padding: 8px; font-weight: bold;">📅 Date & Time:</td><td style="padding: 8px;">{now_str}</td></tr>
                <tr><td style="padding: 8px; font-weight: bold;">🌐 Visitor IP:</td><td style="padding: 8px;"><code>{client_ip}</code></td></tr>
                <tr><td style="padding: 8px; font-weight: bold;">💻 Device/Browser:</td><td style="padding: 8px; font-size: 12px;">{user_agent}</td></tr>
            </table>
        </div>
        <div style="text-align: center; color: #64748b; font-size: 11px; margin-top: 20px;">
            JAHAN JAMIN, WAHAN JAMIN24 — Live Demonstration Alerts
        </div>
    </div>
    """
    send_email_async(subject, html_content, text_content)


def notify_video_upload(filename: str, object_name: str, size_mb: float):
    """Triggered when a video is uploaded."""
    now_str = datetime.now().strftime("%d %B %Y, %I:%M:%S %p")
    subject = f"New Video Uploaded: {filename}"
    
    text_content = f"New video uploaded to Jamin24!\nFile: {filename}\nSize: {size_mb:.2f} MB\nTime: {now_str}"
    
    html_content = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; rounded: 16px;">
        <div style="background-color: #0D473B; padding: 15px; text-align: center; border-radius: 10px;">
            <h2 style="color: #ffffff; margin: 0;">📤 New Video Uploaded</h2>
        </div>
        <div style="padding: 20px; color: #1e293b;">
            <h3 style="color: #0D473B;">📹 Video File Received!</h3>
            <p>A user uploaded a raw footage clip for plot reel processing.</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                <tr><td style="padding: 8px; font-weight: bold;">📁 Original Filename:</td><td style="padding: 8px; color: #0D473B; font-weight: bold;">{filename}</td></tr>
                <tr><td style="padding: 8px; font-weight: bold;">💾 Size:</td><td style="padding: 8px;">{size_mb:.2f} MB</td></tr>
                <tr><td style="padding: 8px; font-weight: bold;">🆔 Object Name:</td><td style="padding: 8px; font-family: monospace;">{object_name}</td></tr>
                <tr><td style="padding: 8px; font-weight: bold;">📅 Upload Time:</td><td style="padding: 8px;">{now_str}</td></tr>
            </table>
        </div>
        <div style="text-align: center; color: #64748b; font-size: 11px; margin-top: 20px;">
            Jamin24 Real Estate AI Video Platform
        </div>
    </div>
    """
    send_email_async(subject, html_content, text_content)


def notify_reel_generated(reel_type: str, clip_count: int, prompt_text: str = ""):
    """Triggered when a promo reel is generated."""
    now_str = datetime.now().strftime("%d %B %Y, %I:%M:%S %p")
    subject = f"🎬 Promo Reel Generated ({clip_count} Clips)"
    
    text_content = f"New AI Reel Generated!\nType: {reel_type}\nClips: {clip_count}\nPrompt: {prompt_text}\nTime: {now_str}"
    
    html_content = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; rounded: 16px;">
        <div style="background-color: #0D473B; padding: 15px; text-align: center; border-radius: 10px;">
            <h2 style="color: #ffffff; margin: 0;">🎉 AI Reel Generation Complete!</h2>
        </div>
        <div style="padding: 20px; color: #1e293b;">
            <h3 style="color: #0D473B;">🎬 Video Reel Created!</h3>
            <p>Someone generated a full promo reel with AI voiceover & boundary tracking highlights.</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                <tr><td style="padding: 8px; font-weight: bold;">🎞️ Workflow Type:</td><td style="padding: 8px; color: #0D473B; font-weight: bold;">{reel_type}</td></tr>
                <tr><td style="padding: 8px; font-weight: bold;">📍 Clips Merged:</td><td style="padding: 8px;">{clip_count} Clips</td></tr>
                <tr><td style="padding: 8px; font-weight: bold;">🗣️ Script / Info:</td><td style="padding: 8px;">{prompt_text or 'Default Real Estate Prompt'}</td></tr>
                <tr><td style="padding: 8px; font-weight: bold;">📅 Created At:</td><td style="padding: 8px;">{now_str}</td></tr>
            </table>
        </div>
        <div style="text-align: center; color: #64748b; font-size: 11px; margin-top: 20px;">
            Jamin24 Real Estate AI Video Platform
        </div>
    </div>
    """
    send_email_async(subject, html_content, text_content)
