#!/usr/bin/env node
/**
 * setup-gemini-mcp.js
 *
 * Cria o shim de compatibilidade para o gemini-mcp-tool no Windows.
 *
 * Problema: gemini-mcp-tool v1.1.4 hardcoda o path
 *   <node_dir>/node_modules/@google/gemini-cli/dist/index.js
 * mas @google/gemini-cli v0.36+ passou a usar bundle/gemini.js.
 *
 * Solucao: criar dist/index.js que redireciona para bundle/gemini.js.
 *
 * Quando rodar: apos atualizar Node via nvm, ou reinstalar @google/gemini-cli.
 * Como rodar:   npm run setup-gemini-mcp
 */

const fs = require('fs');
const path = require('path');

const nodeDir = path.dirname(process.execPath);
const geminiPkg = path.join(nodeDir, 'node_modules', '@google', 'gemini-cli');
const distDir = path.join(geminiPkg, 'dist');
const shimIndex = path.join(distDir, 'index.js');
const shimPkg = path.join(distDir, 'package.json');
const bundleEntry = path.join(geminiPkg, 'bundle', 'gemini.js');

if (!fs.existsSync(geminiPkg)) {
  console.error('ERRO: @google/gemini-cli nao encontrado em', geminiPkg);
  console.error('Execute: npm install -g @google/gemini-cli');
  process.exit(1);
}

if (!fs.existsSync(bundleEntry)) {
  console.error('ERRO: bundle/gemini.js nao encontrado. Versao do pacote incompativel?');
  process.exit(1);
}

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

fs.writeFileSync(shimPkg, '{"type": "module"}\n');
fs.writeFileSync(shimIndex, "// Shim: redirects to bundle/gemini.js (package restructured in v0.36+)\nimport '../bundle/gemini.js';\n");

console.log('Shim criado com sucesso em', distDir);
console.log('MCP gemini-cli pronto para uso.');
