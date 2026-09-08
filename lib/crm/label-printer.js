import { spawn } from 'node:child_process';

const LABEL_MEDIA = 'Custom.100x150mm';

export function labelPrinterConfig(env = process.env) {
  const host = String(env.LABEL_PRINTER_SSH_HOST || '').trim();
  const user = String(env.LABEL_PRINTER_SSH_USER || '').trim();
  const target = String(env.LABEL_PRINTER_SSH_TARGET || '').trim();
  const local = String(env.LABEL_PRINTER_LOCAL || '').trim().toLowerCase() === 'true';
  const queue = String(env.LABEL_PRINTER_QUEUE || '').trim();
  const identityFile = String(env.LABEL_PRINTER_SSH_IDENTITY_FILE || '').trim();
  const port = String(env.LABEL_PRINTER_SSH_PORT || '22').trim();

  if ((!local && !host && !target) || !queue) {
    return { ok: false, error: 'Label printer is not configured. Set LABEL_PRINTER_LOCAL=true (when CUPS runs on this server), or LABEL_PRINTER_SSH_TARGET, plus LABEL_PRINTER_QUEUE.' };
  }
  if ((host && !/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host)) || (target && !/^[a-zA-Z0-9][a-zA-Z0-9._@.-]*$/.test(target)) || (user && !/^[a-zA-Z0-9._-]+$/.test(user)) || !/^[a-zA-Z0-9._-]+$/.test(queue) || !/^\d{1,5}$/.test(port)) {
    return { ok: false, error: 'Label printer configuration contains an invalid SSH host, user, port, or queue name.' };
  }
  return { ok: true, local, target: target || (user ? `${user}@${host}` : host), queue, identityFile, port };
}

export async function printLabelPdf(pdf, filename = 'shipping-label.pdf', env = process.env) {
  const config = labelPrinterConfig(env);
  if (!config.ok) return config;
  const body = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
  if (!body.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    return { ok: false, error: 'The carrier label is not a PDF, so it cannot be printed as a 10 × 15 cm label.' };
  }

  const printArgs = ['-d', config.queue, '-o', `media=${LABEL_MEDIA}`, '-o', 'fit-to-page', '-o', 'orientation-requested=3', '-t', safeTitle(filename)];
  if (config.local) {
    try {
      const result = await runProcess('lp', printArgs, body);
      if (result.code !== 0) return { ok: false, error: cleanError(result.stderr || `Print command exited with code ${result.code}.`) };
      return { ok: true, message: `Queued ${filename} on ${config.queue} (10 × 15 cm).` };
    } catch (error) {
      return { ok: false, error: error.message || 'Unable to reach the local label printer.' };
    }
  }

  const remoteCommand = `lp -d '${config.queue}' -o media=${LABEL_MEDIA} -o fit-to-page -o orientation-requested=3 -t '${safeTitle(filename)}'`;
  const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', '-p', config.port];
  if (config.identityFile) args.push('-i', config.identityFile);
  args.push(config.target, remoteCommand);

  try {
    const result = await runProcess('ssh', args, body);
    if (result.code !== 0) return { ok: false, error: cleanError(result.stderr || result.stdout || `SSH print command exited with code ${result.code}.`) };
    return { ok: true, message: `Queued ${filename} on ${config.queue} (10 × 15 cm).` };
  } catch (error) {
    return { ok: false, error: error.message || 'Unable to reach the label printer host.' };
  }
}

function safeTitle(value) {
  return String(value || 'shipping-label.pdf').replace(/[^a-zA-Z0-9._ -]/g, '-').replace(/'/g, '');
}

function cleanError(value) {
  return String(value).replace(/\s+/g, ' ').trim().slice(0, 500);
}

function runProcess(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stderr }));
    child.stdin.on('error', reject);
    child.stdin.end(input);
  });
}
