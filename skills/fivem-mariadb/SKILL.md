---
name: fivem-mariadb
description: The database layer FiveM servers actually run — MariaDB/MySQL through oxmysql (node-mysql2). Covers the connection string and its server.cfg traps, MySQL.query/single/scalar/insert/update/prepare/transaction and their await forms, positional vs deprecated named placeholders, schema and indexing for characters/vehicles/inventory tables, JSON columns vs normalised tables, migrations, and the single-statement atomic UPDATE that prevents money duplication. Use when writing any query in a resource, designing or indexing a player/character table, debugging a slow query warning, converting mysql-async or ghmattimysql code, or when a race between two queries can duplicate money or items.
---

# MariaDB for FiveM

FiveM servers run **MariaDB or MySQL**, reached from Lua through **oxmysql**, which is a
wrapper over Node's `mysql2`. Every query in a resource goes through that path, so the
practical knowledge is oxmysql's API plus the small number of schema decisions that decide
whether a server stays responsive at 64 players.

Upstream is explicit about the engine: **use MariaDB**, not MySQL 8. MySQL 8 added reserved
keywords that break existing resources (`groups`, `stored` and friends appear in real schemas)
and does not allow default values on `LONGTEXT`/`JSON` columns, which a lot of framework
schemas rely on. And do not install XAMPP for this — it is a web server stack; install MariaDB
directly.

## Connection string

```cfg
# in server.cfg — always `set`, never `setr`
set mysql_connection_string "mysql://root:12345@localhost:3306/fivem"

# or the semicolon form
set mysql_connection_string "user=root;password=12345;host=localhost;port=3306;database=fivem"
```

Two traps stack here:

1. **`setr` replicates to every client.** A replicated connection string hands your database
   credentials to anyone who joins. Use `set`.
2. **server.cfg splits every line on `;`.** The semicolon form is therefore only safe
   **quoted** — unquoted, the parser runs `password=12345` as a console command. See
   `fivem-server-ops` for the full semicolon trap.

Upstream also warns that `; , / ? : @ & = + $ #` are reserved or unsupported depending on the
format — a password containing any of them can break parsing. Change the password or switch
connection-string format rather than trying to escape it.

Useful convars (defaults from source):

```cfg
set mysql_slow_query_warning 200   # ms before a query is logged as slow
set mysql_debug true               # print every query; or an array of resource names
set mysql_transaction_isolation_level 2   # 1 REPEATABLE READ · 2 READ COMMITTED (default)
                                          # 3 READ UNCOMMITTED · 4 SERIALIZABLE
```

`oxmysql_debug add <resource>` / `remove <resource>` narrows debug output live without a
restart.

## The API

Server-side only. `MySQL` comes from `@oxmysql/lib/MySQL.lua` in `server_scripts`.

| Method | Returns |
|---|---|
| `MySQL.query` | every matching row |
| `MySQL.single` | one row (all columns) |
| `MySQL.scalar` | the first column of the first row |
| `MySQL.insert` | the new `insertId` |
| `MySQL.update` | number of affected rows |
| `MySQL.prepare` | prepared statement — column, row, or rows depending on the select |
| `MySQL.transaction` | boolean: all queries committed, or none |
| `MySQL.rawExecute` | raw driver result |

Each has an `.await` form for promise style, and a callback form:

```lua
-- await (preferred — reads like ordinary code, still non-blocking)
local row = MySQL.single.await(
    'SELECT firstname, lastname FROM users WHERE identifier = ? LIMIT 1',
    { identifier }
)

-- callback
MySQL.query('SELECT * FROM users WHERE identifier = ?', { identifier }, function(rows)
    -- …
end)
```

`MySQL.ready(cb)` / `MySQL.ready.await()` waits for the connection before the first query —
useful for schema setup at resource start.

Legacy aliases exist for migration: `MySQL.Sync.fetchAll` → `query`, `MySQL.Sync.execute` →
`update`, `MySQL.Sync.fetchScalar` → `scalar`, plus `exports.ghmattimysql.*`. They work;
new code should use the direct names.

### Placeholders

```lua
-- positional ? — this is the form to use
MySQL.scalar.await('SELECT username FROM users WHERE identifier = ? AND `group` = ?', {
    identifier, group
})

-- named @placeholders — DEPRECATED upstream
MySQL.scalar.await('SELECT username FROM users WHERE identifier = @identifier', {
    identifier = identifier
})
```

Named placeholders still function (oxmysql ships its own `named-placeholders` patch) but are
marked deprecated. Write `?`.

Never build SQL with `..` string concatenation. Placeholders are what make a query
injection-proof, and a concatenated `identifier` is a SQL-injection hole reachable from any
net event.

`MySQL.prepare` is stricter than the rest and it is worth knowing why before switching to it
for speed: **only `?` value placeholders** — `??` column placeholders and named placeholders
throw. It also skips some of oxmysql's type conversion, so `DATE` does not come back as the
usual FiveM datestring, and `TINYINT(1)`/`BIT` do not come back as booleans.

### Transactions

All queries commit, or none do.

```lua
-- per-query parameters
local ok = MySQL.transaction.await({
    { query = 'UPDATE accounts SET balance = balance - ? WHERE id = ?', values = { amount, from } },
    { query = 'UPDATE accounts SET balance = balance + ? WHERE id = ?', values = { amount, to } },
})

-- or shared parameters across queries
local ok = MySQL.transaction.await({
    'INSERT INTO test (id, name) VALUES (@someid, @somename)',
    'UPDATE test SET name = @newname WHERE id = @someid',
}, { someid = 2, somename = 'John Doe', newname = 'John Notdoe' })
```

The return value is a boolean — check it. A silently failed transfer is money that vanished.

## The atomic update that prevents duplication

Read-then-write is a race. Two events arriving in the same tick both read the old balance,
both write, and the player has spent the same money twice.

```lua
-- WRONG — check and write are two statements
local balance = MySQL.scalar.await('SELECT cash FROM users WHERE id = ?', { id })
if balance >= price then
    MySQL.update.await('UPDATE users SET cash = cash - ? WHERE id = ?', { price, id })
end

-- RIGHT — one statement; the database enforces the condition
local affected = MySQL.update.await(
    'UPDATE users SET cash = cash - ? WHERE id = ? AND cash >= ?',
    { price, id, price }
)

if affected == 0 then return end   -- insufficient funds, or someone else got there first
```

`affected == 0` is the failure signal and must be handled. This is the database half of
security rule **SEC-6**; see `fivem-security` for the event-handler half.

## Schema

Table shapes that hold up:

```sql
CREATE TABLE characters (
  citizenid   VARCHAR(50)  NOT NULL,
  license     VARCHAR(60)  NOT NULL,
  firstname   VARCHAR(50)  NOT NULL,
  lastname    VARCHAR(50)  NOT NULL,
  money       JSON         NULL,
  last_seen   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (citizenid),
  KEY idx_characters_license (license)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE vehicles (
  plate       VARCHAR(8)   NOT NULL,
  owner       VARCHAR(50)  NOT NULL,
  model       VARCHAR(50)  NOT NULL,
  props       JSON         NULL,
  PRIMARY KEY (plate),
  KEY idx_vehicles_owner (owner),
  CONSTRAINT fk_vehicles_owner FOREIGN KEY (owner)
    REFERENCES characters (citizenid) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- **`utf8mb4`, always.** Plain `utf8` in MySQL is three bytes and cannot store emoji or many
  scripts — a player name that fails to save is usually this.
- **Index every lookup column.** `citizenid`, `license`, `owner`, `identifier`. Player join
  runs these queries; without an index each join is a full table scan and login time grows
  with the table.
- **InnoDB**, not MyISAM — transactions and row-level locking are exactly what the atomic
  update above depends on.
- **Foreign keys with `ON DELETE CASCADE`** stop orphaned vehicles outliving deleted
  characters.

### JSON columns vs normalised tables

JSON is right for **blobs you always read whole and never query into**: vehicle mod props,
character appearance, position. It is wrong for anything you filter, sort, or aggregate on —
"every item of type X across all players" against a JSON inventory means scanning and
decoding every row.

Rule of thumb: if a `WHERE` clause would ever need to reach inside it, normalise it into its
own table with an index.

### Migrations

Run schema changes from a versioned SQL file, not by hand on production. A resource can
bootstrap its own tables at start:

```lua
MySQL.ready(function()
    MySQL.query.await([[
        CREATE TABLE IF NOT EXISTS my_resource_data (
          id INT UNSIGNED NOT NULL AUTO_INCREMENT,
          citizenid VARCHAR(50) NOT NULL,
          PRIMARY KEY (id),
          KEY idx_my_resource_citizenid (citizenid)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ]])
end)
```

`CREATE TABLE IF NOT EXISTS` is safe to run every start. `ALTER TABLE` is not — guard it, or
keep numbered migration files and record which have run.

## Performance

- Query **on join and on save**, not every tick. Player data belongs in memory while they are
  online; the database is where it is persisted, not where it lives.
- Batch saves. One `MySQL.transaction` at an interval beats one `MySQL.update` per player per
  field.
- A slow query warning names the resource and the statement — start with `EXPLAIN` on it, and
  look for a missing index before anything else.
- `MySQL.prepare` pays off for the same statement run many times with different parameters,
  given its type-conversion caveats above.

## Boundaries

- Framework-provided player data (`xPlayer`, `PlayerData`, ox character accounts) usually
  already persists itself — check before writing your own table. See `fivem-frameworks`.
- Validating what a client sent before it reaches a query → `fivem-security`.
- Postgres/Supabase are not what FiveM servers run; that is a different skill entirely.
