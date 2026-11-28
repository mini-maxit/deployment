# Encrypted backups

`backup.sh` writes one directory per run, encrypted with [age](https://github.com/FiloSottile/age):

```
/var/backups/maxit/maxit-20261127T120000Z/
├── db.dump.age        # pg_dump custom format, taken inside the db container
├── files.tar.gz.age   # uploaded files, docker-compose/.env, nginx/ssl
└── SHA256SUMS
```

A failed run exits non-zero and leaves no `maxit-*` directory. A killed process or power cut can
leave a `.partial.*` directory, which is safe to delete. Encrypted output differs on every run.

Not included: RabbitMQ messages and worker temporary files. Uploads changed or deleted while a
backup runs may not match the database. Old backups are never deleted, and nothing is copied off
the server: do both yourself.

## Setup

1. On **your own machine**, create the key pair:

   ```bash
   age-keygen -o maxit-backup.key
   age-keygen -y maxit-backup.key > backup.recipients
   ```

   Keep two copies of `maxit-backup.key` away from the server. Without it no backup can be read.

2. On the server (Debian/Ubuntu), install the tool:

   ```bash
   apt-get install age
   ```

3. Copy only `backup.recipients` (the public key) to `/opt/deployment/docker-compose/`.

## Run

As root on the server, with the `db` service running:

```bash
/opt/deployment/scripts/backup.sh
```

`BACKUP_DIR` and `AGE_RECIPIENTS_FILE` override the default locations.

## Restore

Run these from a copy of one backup directory on your machine, so the private key stays off the
server. Check the copy first:

```bash
sha256sum -c SHA256SUMS
```

**Restoring replaces the current database.** Take a fresh backup first if the server still works.

1. Files. This unpacks into a new directory, so nothing live is overwritten:

   ```bash
   age -d -i maxit-backup.key files.tar.gz.age | ssh vm 'mkdir /root/restore && tar -C /root/restore -xzpf -'
   ```

   Copy what you need from `/root/restore` into `/opt/deployment` (on a new server, all of it,
   with `cp -a /root/restore/. /opt/deployment/`), then delete `/root/restore`.

2. Stop the services that use the database, and make sure `db` runs:

   ```bash
   ssh vm 'cd /opt/deployment/docker-compose && docker compose stop nginx backend worker && docker compose up -d --wait db'
   ```

3. Recreate the empty database:

   ```bash
   ssh vm 'cd /opt/deployment/docker-compose && docker compose exec -T db sh -c '\''dropdb --force -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'\'''
   ```

4. Load the dump:

   ```bash
   age -d -i maxit-backup.key db.dump.age | ssh vm 'cd /opt/deployment/docker-compose && docker compose exec -T db sh -c '\''exec pg_restore --exit-on-error -U "$POSTGRES_USER" -d "$POSTGRES_DB"'\'''
   ```

5. Start everything:

   ```bash
   ssh vm 'cd /opt/deployment/docker-compose && docker compose up -d && docker compose restart nginx'
   ```

## Test

`scripts/backup_test.sh` backs up and restores a throwaway Postgres container. It needs Docker,
`age`, `flock` and `sha256sum`.
