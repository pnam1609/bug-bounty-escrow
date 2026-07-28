# Shared-VPS Supabase notes

The production Supabase stack is a separate Compose project named `supabase`.
It uses the official, versioned Docker configuration from the Supabase
repository plus `docker-compose.shared-vps.yml`.

The override prevents conflicts with services already running on the host:

- Kong API gateway: `127.0.0.1:7832`
- Supavisor session mode: `127.0.0.1:5433`
- Supavisor transaction mode: `127.0.0.1:6544`

No Supabase port is exposed publicly. Host Nginx terminates TLS for
`supabase.bountyescrow.xyz` and proxies the supported public API paths to Kong.

The application joins the external Docker network `supabase_default`:

- API Supabase URL: `http://supabase-kong:8000`
- Migration database URL:
  `postgresql://postgres:<password>@supabase-db:5432/postgres`

Do not run Supabase's reset script on this VPS. It destroys the self-hosted
database and storage data. Back up the database, Storage directory, environment
file, and signing keys before any Supabase update.
