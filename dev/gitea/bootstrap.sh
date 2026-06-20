#!/usr/bin/env sh
# Bootstraps the local-development Gitea over its HTTP API: a site-admin user, the
# low-privilege bot user the provider authenticates as, a demo org, a read-only team
# the bot belongs to, and a set of seeded repos carrying demo workflow + code files.
# Idempotent, so re-running is safe. The gitea-init compose service runs it
# automatically; it is also launchable by hand (defaults target the published
# localhost port).
#
# HTTP-first, mirroring dev/garage/bootstrap.sh: no `docker exec`, no shared data
# volume, no second Gitea process touching the SQLite file. The one endpoint that
# is not a clean REST call is the very first admin: Gitea has no API to mint the
# first user (every admin API needs an existing admin), so we register it through
# the web sign-up form, which carries CSRF. Gitea makes the first registered user a
# site administrator; every later object is created with that admin's Basic auth.
set -eu

GITEA_URL="${GITEA_URL:-http://localhost:3000}"
ADMIN_USER="${GITEA_ADMIN_USERNAME:-gitea-admin}"
ADMIN_PASSWORD="${GITEA_ADMIN_PASSWORD:-gitea-admin-dev-password}"
ADMIN_EMAIL="${GITEA_ADMIN_EMAIL:-gitea-admin@shipfox.local}"
# The bot the provider authenticates as. Username + password must match the
# GITEA_SERVICE_USERNAME / GITEA_SERVICE_TOKEN in apps/api/.env: dev uses the
# password itself as the Basic-auth secret, so no generated-token handoff exists.
BOT_USER="${GITEA_SERVICE_USERNAME:-shipfox-bot}"
BOT_PASSWORD="${GITEA_SERVICE_TOKEN:-shipfox-bot-dev-password}"
BOT_EMAIL="${GITEA_BOT_EMAIL:-shipfox-bot@shipfox.local}"
ORG="${GITEA_ORG:-shipfox-demo}"
# A read-only team that includes every repo, current and future. It is the bot's
# only org membership, so a leaked bot credential is bounded to read access on the
# demo repos rather than the whole instance (the ENG-541 bot-user floor).
READ_TEAM="shipfox-readers"
SEED_DIR="${SEED_DIR:-/seed}"
COOKIE_JAR="$(mktemp)"

admin_api() {
  method="$1"
  path="$2"
  body="${3:-}"
  if [ -n "$body" ]; then
    curl -fsS -X "$method" "$GITEA_URL/api/v1$path" \
      -u "$ADMIN_USER:$ADMIN_PASSWORD" \
      -H 'Content-Type: application/json' \
      -d "$body"
  else
    curl -fsS -X "$method" "$GITEA_URL/api/v1$path" \
      -u "$ADMIN_USER:$ADMIN_PASSWORD"
  fi
}

# HTTP status of an authenticated GET, used as an existence probe so each step can
# skip work it already did on a previous run.
admin_status() {
  curl -s -o /dev/null -w '%{http_code}' \
    -u "$ADMIN_USER:$ADMIN_PASSWORD" "$GITEA_URL/api/v1$1"
}

# Register the first user (Gitea promotes it to site admin) through the web sign-up
# form. Skipped once the admin exists. The form is CSRF-protected: Gitea echoes one
# token into both the `_csrf` cookie and the hidden form field, so we read it back
# from the page and submit it with the same cookie jar.
if [ "$(admin_status "/users/$ADMIN_USER")" = "200" ]; then
  echo "Gitea admin '$ADMIN_USER' already exists, skipping sign-up."
else
  signup_page="$(curl -fsS -c "$COOKIE_JAR" "$GITEA_URL/user/sign_up")"
  csrf="$(printf '%s' "$signup_page" \
    | grep -o 'name="_csrf"[^>]*value="[^"]*"' \
    | head -n1 \
    | sed 's/.*value="\([^"]*\)".*/\1/')"
  if [ -z "$csrf" ]; then
    csrf="$(grep _csrf "$COOKIE_JAR" | awk '{print $NF}' | head -n1)"
  fi

  curl -fsS -b "$COOKIE_JAR" -c "$COOKIE_JAR" -o /dev/null \
    -X POST "$GITEA_URL/user/sign_up" \
    --data-urlencode "_csrf=$csrf" \
    --data-urlencode "user_name=$ADMIN_USER" \
    --data-urlencode "email=$ADMIN_EMAIL" \
    --data-urlencode "password=$ADMIN_PASSWORD" \
    --data-urlencode "retype=$ADMIN_PASSWORD"
  echo "Created Gitea site admin '$ADMIN_USER'."
fi

# Bot user: a regular (non-admin) account created through the admin API.
if [ "$(admin_status "/users/$BOT_USER")" = "200" ]; then
  echo "Bot user '$BOT_USER' already exists, skipping."
else
  admin_api POST /admin/users "$(jq -n \
    --arg username "$BOT_USER" \
    --arg email "$BOT_EMAIL" \
    --arg password "$BOT_PASSWORD" \
    '{username: $username, email: $email, password: $password, must_change_password: false}')" \
    >/dev/null
  echo "Created bot user '$BOT_USER'."
fi

# Demo org owned by the admin. Public so it is easy to browse, while its repos stay
# private so the checkout path genuinely exercises Basic auth.
if [ "$(admin_status "/orgs/$ORG")" = "200" ]; then
  echo "Org '$ORG' already exists, skipping."
else
  admin_api POST /orgs "$(jq -n --arg org "$ORG" '{username: $org, visibility: "public"}')" >/dev/null
  echo "Created org '$ORG'."
fi

# Read-only team scoped to repo code only (clone + contents read), covering all
# current and future repos. Look it up by name first so a re-run reuses it.
team_id="$(admin_api GET "/orgs/$ORG/teams" | jq -r --arg name "$READ_TEAM" '.[] | select(.name == $name) | .id' | head -n1)"
if [ -z "$team_id" ]; then
  team_id="$(admin_api POST "/orgs/$ORG/teams" "$(jq -n --arg name "$READ_TEAM" \
    '{name: $name, permission: "read", includes_all_repositories: true, units: ["repo.code"]}')" \
    | jq -r '.id')"
  echo "Created read team '$READ_TEAM' (#$team_id)."
fi
# PUT is idempotent: re-adding an existing member is a no-op.
admin_api PUT "/teams/$team_id/members/$BOT_USER" >/dev/null
echo "Bot user '$BOT_USER' is a member of read team '$READ_TEAM'."

# One repo per immediate subdirectory of the seed tree; its files are uploaded
# below. `auto_init` creates the default branch so the contents API has a branch to
# commit against, and a README the demo repo can show.
for repo_dir in "$SEED_DIR"/*/; do
  [ -d "$repo_dir" ] || continue
  repo="$(basename "$repo_dir")"

  if [ "$(admin_status "/repos/$ORG/$repo")" = "200" ]; then
    echo "Repo '$ORG/$repo' already exists, skipping creation."
  else
    admin_api POST "/orgs/$ORG/repos" "$(jq -n --arg name "$repo" \
      '{name: $name, private: true, auto_init: true, default_branch: "main"}')" >/dev/null
    echo "Created repo '$ORG/$repo'."
  fi

  # Upload every seeded file via the contents API. A file that is already present
  # (including the auto-init README) is left untouched so re-runs do not churn it.
  find "$repo_dir" -type f | while read -r file; do
    rel="${file#"$repo_dir"}"
    if [ "$(admin_status "/repos/$ORG/$repo/contents/$rel")" = "200" ]; then
      continue
    fi
    content="$(base64 <"$file" | tr -d '\n')"
    admin_api POST "/repos/$ORG/$repo/contents/$rel" "$(jq -n \
      --arg content "$content" \
      --arg message "Seed $rel" \
      '{content: $content, message: $message, branch: "main"}')" >/dev/null
    echo "  seeded $repo/$rel"
  done
done

rm -f "$COOKIE_JAR"
echo "Gitea ready: org '$ORG', bot '$BOT_USER', repos seeded under $GITEA_URL/$ORG."
