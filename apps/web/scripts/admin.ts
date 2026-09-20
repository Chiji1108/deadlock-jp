import { password, text, isCancel } from '@clack/prompts'
import { hashPassword } from '../src/lib/auth/password'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Only an operator with local access / Cloudflare credentials can provision users.
const mode = process.argv.includes('--remote')
  ? '--remote'
  : process.argv.includes('--local')
    ? '--local'
    : null
const reset = process.argv.includes('--reset')
if (!mode)
  throw new Error(
    'Specify --local or --remote. Add --reset to reset an existing administrator password.',
  )
const emailValue = await text({
  message: `管理者メールアドレス (${mode})`,
  validate: (s) =>
    /^\S+@\S+\.\S+$/.test(s ?? '')
      ? undefined
      : 'メールアドレスを入力してください',
})
if (isCancel(emailValue)) process.exit(0)
const email = emailValue.trim().toLowerCase()
const value = await password({
  message: 'パスワード（15〜128文字）',
  validate: (s) =>
    s && s.length >= 15 && s.length <= 128
      ? undefined
      : '15〜128文字で入力してください',
})
if (isCancel(value)) process.exit(0)
const confirm = await password({ message: 'パスワード（確認）' })
if (isCancel(confirm)) process.exit(0)
if (value !== confirm) throw new Error('Passwords do not match')
const quote = (s: string) => `'${s.replaceAll("'", "''")}'`
const workdir = new URL('../', import.meta.url).pathname
const args = [
  'bunx',
  'wrangler',
  'd1',
  'execute',
  'deadlock-jp',
  mode,
  '--config',
  'wrangler.jsonc',
  ...(mode === '--local' ? ['--persist-to', '../../.wrangler/state'] : []),
]
const read = Bun.spawn(
  [
    ...args,
    '--command',
    `SELECT id, is_admin FROM user WHERE email = ${quote(email)}`,
    '--json',
  ],
  { cwd: workdir, stdout: 'pipe', stderr: 'inherit' },
)
const output = await new Response(read.stdout).text()
if (await read.exited)
  throw new Error('Could not read the auth database. Apply migrations first.')
const existing = JSON.parse(output)[0].results as {
  id: string
  is_admin: number
}[]
if (reset && (!existing.length || !existing[0].is_admin))
  throw new Error('Existing administrator not found')
if (!reset && existing.length)
  throw new Error(
    'Account already exists; use --reset for an administrator password reset',
  )
const id = reset ? existing[0].id : crypto.randomUUID()
const hash = await hashPassword(value)
const now = Date.now()
const sql = reset
  ? `
UPDATE account SET password=${quote(hash)}, updated_at=${now} WHERE user_id=${quote(id)} AND provider_id='credential';
DELETE FROM session WHERE user_id=${quote(id)};
`
  : `
INSERT INTO user (id,name,email,email_verified,created_at,updated_at,is_admin)
VALUES (${quote(id)},'管理者',${quote(email)},0,${now},${now},1);
INSERT INTO account (id,account_id,provider_id,user_id,password,created_at,updated_at)
VALUES (${quote(crypto.randomUUID())},${quote(id)},'credential',${quote(id)},${quote(hash)},${now},${now});
`
const dir = await mkdtemp(join(tmpdir(), 'deadlock-admin-'))
try {
  const file = join(dir, 'admin.sql')
  await writeFile(file, sql, { mode: 0o600 })
  const write = Bun.spawn([...args, '--file', file, '--yes'], {
    cwd: workdir,
    stdout: 'ignore',
    stderr: 'inherit',
  })
  if (await write.exited) throw new Error('Administrator update failed')
  console.log(
    reset
      ? 'パスワードを更新し、既存セッションを失効しました。'
      : '管理者アカウントを作成しました。',
  )
} finally {
  await rm(dir, { recursive: true, force: true })
}
