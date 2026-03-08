import fs from 'fs';
import path from 'path';

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = dir + '/' + file;
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            results = results.concat(walk(file));
        } else {
            if (file.endsWith('.jsx') || file.endsWith('.js')) results.push(file);
        }
    });
    return results;
}

const files = walk('./src');
files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    const initial = content;
    content = content.replace(/dark:bg-gray-800/g, 'dark:bg-brand-800');
    content = content.replace(/dark:bg-gray-900/g, 'dark:bg-brand-900');
    content = content.replace(/dark:border-gray-700/g, 'dark:border-brand-700');
    content = content.replace(/dark:border-gray-600/g, 'dark:border-brand-600');
    content = content.replace(/dark:hover:bg-gray-700/g, 'dark:hover:bg-brand-700');
    content = content.replace(/dark:hover:bg-gray-800/g, 'dark:hover:bg-brand-800');
    if (initial !== content) {
        fs.writeFileSync(file, content, 'utf8');
        console.log('Updated ' + file);
    }
});
console.log('Done replacing colors.');
