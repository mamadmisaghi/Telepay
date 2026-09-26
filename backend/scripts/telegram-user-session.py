"""Run locally: python -m pip install telethon==1.45.0; python scripts/telegram-user-session.py"""
import asyncio, getpass, os
from pathlib import Path
from telethon import TelegramClient, functions
from telethon.sessions import StringSession

async def main():
    api_id = int(input('Telegram API ID: ').strip())
    api_hash = getpass.getpass('Telegram API Hash (hidden): ').strip()
    client = TelegramClient(StringSession(), api_id, api_hash)
    try:
        await client.start(phone=lambda: input('Project account phone (+country code): ').strip(), code_callback=lambda: getpass.getpass('Telegram login code (hidden): '), password=lambda: getpass.getpass('Two-step verification password (hidden): '))
        me = await client.get_me()
        if me.bot:
            raise RuntimeError('Global search requires a user account, not a bot.')
        await client(functions.contacts.SearchRequest(q='telegram', limit=1))
        path = Path(__file__).resolve().parents[2] / 'deploy' / 'secrets' / 'telegram-user-session.env'
        path.parent.mkdir(parents=True, exist_ok=True)
        # GramJS and Telethon serialize StringSession differently. Convert explicitly.
        import base64, struct, ipaddress
        addr=str(client.session.server_address).encode()
        gram=base64.b64encode(struct.pack('>BH',client.session.dc_id,len(addr))+addr+struct.pack('>H',client.session.port)+client.session.auth_key.key).decode()
        fd=os.open(path, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
        with os.fdopen(fd,'w') as file:
            file.write(f'TELEGRAM_API_ID={api_id}\nTELEGRAM_API_HASH={api_hash}\nTELEGRAM_SEARCH_SESSION=1{gram}\n')
        print('Search verified. Settings saved to:', path)
        print('Copy the three values into the TelePaid web service Railway Variables. Do not commit or post this file.')
    finally:
        await client.disconnect()
asyncio.run(main())
