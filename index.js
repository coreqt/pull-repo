process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Ignore SSL Certificate Errors

// This script downloads all files from a private GitHub repository using the API
// Ensure that the GITHUB_TOKEN environment variable is set before running
require('dotenv').config();

const { spawn } = require('child_process');

const fs = require('fs');
const path = require('path');
const https = require('https');

const envVars = require('./env.json');

const OWNER = process.env.OWNER;
const REPO = process.env.REPO;
const BRANCH = process.env.BRANCH || 'main'; // Change if needed
const TOKEN = process.env.GITHUB_TOKEN;

if (!TOKEN) {
    console.error('GITHUB_TOKEN environment variable not set.');
    process.exit(1);
}

function githubApi(path) {
    return {
        hostname: 'api.github.com',
        path,
        method: 'GET',
        headers: {
            'User-Agent': 'Node.js',
            'Authorization': `token ${TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
        },
    };
}

function fetchJson(options) {
    return new Promise((resolve, reject) => {
        https.get(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(JSON.parse(data));
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        }).on('error', reject);
    });
}

function fetchFile(url, dest) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'Node.js',
                'Authorization': `token ${TOKEN}`,
                'Accept': 'application/vnd.github.v3.raw',
            }
        };

        
        https.get(url, options, (res) => {

            if (res.statusCode === 200) {
                const fileStream = fs.createWriteStream(dest);
                res.pipe(fileStream);
                fileStream.on('finish', () => fileStream.close(resolve));

            } else {
                reject(new Error(`Failed to download ${url}: ${res.statusCode}`));
            }

        }).on('error', reject);
    });
}

async function downloadRepo() {
    try {
        // Get the tree recursively
        const treeUrl = `/repos/${OWNER}/${REPO}/git/trees/${BRANCH}?recursive=1`;
        const treeData = await fetchJson(githubApi(treeUrl));
        const files = treeData.tree.filter(item => item.type === 'blob');

        // check if the files in the folder exist. if yes delete all it contains
        const repoPath = path.join(__dirname, 'repo');
        let dirContains = fs.readdirSync(repoPath);

        dirContains.forEach((item) =>{
            if(item != '_DONT_DELETE'){
                fs.rmSync(path.join(repoPath, item), {recursive: true});
            }
        })

        for (const file of files) {
            const rawUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${file.path}?ref=${BRANCH}`;
            const localPath = path.join(__dirname, 'repo', file.path);
            fs.mkdirSync(path.dirname(localPath), { recursive: true });
            console.log(`Downloading ${file.path}...`);
            await fetchFile(rawUrl, localPath);
        }
        console.log('Download complete.');
    } catch (err) {
        console.error('Error:', err.message);
    }
}



let runningProcess = null;
let lastCommitSha = null;
const CHECK_INTERVAL = 60 * 1000; // Check every minute
  
function getLatestCommitSha() {
    return fetchJson(githubApi(`/repos/${OWNER}/${REPO}/commits/${BRANCH}`)).then(data => data.sha);
}

function killProcess(proc) {
    if (!proc || proc.killed) return;

    if (process.platform === 'win32') {
        const { exec } = require('child_process');
        exec(`taskkill /PID ${proc.pid} /T /F`, (err) => {
            if (err) {
                console.error('Failed to kill process on Windows:', err.message);
            }
        });
    } else {
        try {
            process.kill(-proc.pid, 'SIGTERM');
        } catch (e) {
            try {
                proc.kill('SIGTERM');
            } catch (err) {
                console.error('Failed to kill process:', err.message);
            }
        }
    }
}

async function runProcess() {
    await downloadRepo();
    return new Promise((resolve, reject) => {
        const buildProc = spawn('npm', ['run', 'build'], {
            cwd: path.join(__dirname, 'repo'),
            stdio: 'inherit',
            shell: true
        });
        buildProc.on('close', (code) => {
            if (code === 0) {
                console.log('npm build completed successfully');
                let pkg = require('./repo/package.json');
                let entryPoint = pkg.main || 'index.js';

                runningProcess = spawn('node', [`${entryPoint}`], {
                    stdio: 'inherit',
                    cwd: path.join(__dirname, 'repo'),
                    shell: true,
                    env: envVars,
                    detached: true

                });

                runningProcess.on('close', resolve);
            } else {
                console.error(`npm build failed with exit code ${code}`);
                reject(new Error('Build failed'));
            }
        });
    });
};

async function main() {
    lastCommitSha = await getLatestCommitSha();
    runProcess();
    setInterval(async () => {
        try {
            const latestSha = await getLatestCommitSha();
            if (latestSha !== lastCommitSha) {
                console.log('Found an Update. Restarting...');
                killProcess(runningProcess);
                lastCommitSha = latestSha;
                runProcess();
            }
        } catch (err) {
            console.error('Error checking for updates:', err.message);
        }
    }, CHECK_INTERVAL);
}

main();
