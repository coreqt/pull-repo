// This script downloads all files from a private GitHub repository using the API
// Ensure that the GITHUB_TOKEN environment variable is set before running

const { spawn } = require('child_process');

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');


const OWNER = 'lux-jsx';
const REPO = 'kiwi';
const BRANCH = 'main'; // Change if needed
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

        for (const file of files) {
            const rawUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${file.path}?ref=${BRANCH}`;
            const localPath = path.join(__dirname, file.path);
            fs.mkdirSync(path.dirname(localPath), { recursive: true });
            console.log(`Downloading ${file.path}...`);
            await fetchFile(rawUrl, localPath);
        }
        console.log('Download complete.');
    } catch (err) {
        console.error('Error:', err.message);
    }
}



async function main() {
    await downloadRepo();

    spawn('npm', ['install'], {
        stdio: 'inherit', // Inherit stdio to see npm output in console
        shell: true // Use shell to handle npm command properly
    }).on('close', (code) => {
        if (code === 0) {
            console.log('npm install completed successfully');
            spawn('node', ['index.js'], { stdio: 'inherit' });
        } else {
            console.error(`npm install failed with exit code ${code}`);
        }

    })

}

main();