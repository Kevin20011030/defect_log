/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Search, 
  FileText, 
  Clipboard, 
  Check, 
  Terminal, 
  Cpu, 
  Download,
  AlertCircle,
  Hash,
  Upload,
  FileUp,
  X,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Sparkles
} from 'lucide-react';
import { queryAs14Pin } from './as14Data';

interface CommandPair {
  id: string;
  targetCommand: string;
  promptPattern: string;
}

interface ExtractionResult {
  lineNum: number;
  command: string;
  output: string[];
  pairId: string;
}

export default function App() {
  const [appMode, setAppMode] = useState<'all' | 'targeted' | 'fault'>('all');
  const [commandPairs, setCommandPairs] = useState<CommandPair[]>([
    { id: crypto.randomUUID(), targetCommand: '', promptPattern: '' }
  ]);
  const [logContent, setLogContent] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [results, setResults] = useState<ExtractionResult[] | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [customExportName, setCustomExportName] = useState('');
  const [copiedItemKey, setCopiedItemKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // States specific to fault location Mode ('fault')
  const [copiedFaultReport, setCopiedFaultReport] = useState(false);
  const [copiedSingleMatch, setCopiedSingleMatch] = useState<string | null>(null);
  const [expandedFaultMatches, setExpandedFaultMatches] = useState<Set<number>>(new Set());

  // States specific to fault chip pin location ('故障芯片管脚定位')
  const [pinModel, setPinModel] = useState<'AS14'>('AS14');
  const [pinCd, setPinCd] = useState<string>('cd0');
  const [pinLane, setPinLane] = useState<string>('lane0');
  const [pinType, setPinType] = useState<'RX' | 'TX'>('RX');
  const [copiedPinResult, setCopiedPinResult] = useState(false);

  // States specific to user commands extractor Mode ('all')
  const [selectedPrompt, setSelectedPrompt] = useState<string>('');
  const [customPromptEnabled, setCustomPromptEnabled] = useState(false);
  const [customPromptText, setCustomPromptText] = useState('');
  const [autoJoinContinuation, setAutoJoinContinuation] = useState(true);
  const [filterBlanks, setFilterBlanks] = useState(true);
  const [allCommandsQuery, setAllCommandsQuery] = useState('');
  const [copiedAll, setCopiedAll] = useState(false);

  // Strips typical terminal device and SSH log timestamp prefixes to expose the raw prompt directly
  const cleanLineTimestamp = (line: string): string => {
    // 1. Remove bracketed float timestamps (e.g. dmesg/uptime like `[  123.456789]`)
    let clean = line.replace(/^\[\s*\d+(\.\d+)?\s*\]\s*/, '');
    
    // 1a. Remove custom bracketed datetime stamps like `[2025-12-11-163934]`
    clean = clean.replace(/^\[\s*\d{4}-\d{2}-\d{2}-\d{6}\s*\]\s*/, '');
    
    // 2. Remove bracketed ISO8601/RFC3339 timestamps (e.g. `[2026-05-20 15:07:15]` or `[2026-05-20T15:07:15.123Z]`)
    clean = clean.replace(/^\[\s*\d{4}[-/]\d{2}[-/]\d{2}[\sT]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)?\s*\]\s*/, '');
    
    // 3. Remove bracketed syslog-like timestamps (e.g. `[May 20 15:07:15]`)
    clean = clean.replace(/^\[\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+\s+\d{2}:\d{2}:\d{2}(\s+\d{4})?\s*\]\s*/i, '');
    
    // 4. Remove syslog priority headers like `<14>` or `<182>`
    clean = clean.replace(/^<\d+>\s*/, '');
    
    // 4a. Remove custom hyphenated datetime stamps like `20251113_13:49:41`
    clean = clean.replace(/^\d{8}_\d{2}:\d{2}:\d{2}\s*/, '');
    
    // 5. Remove plain ISO8601/RFC3339 timestamps (e.g. `2026-05-20 15:07:15` or `2026-05-20T15:07:15.123Z`)
    clean = clean.replace(/^\d{4}[-/]\d{2}[-/]\d{2}[\sT]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)?\s*/, '');
    
    // 6. Remove plain syslog-like timestamps (e.g. `May 20 15:07:15` or `May  9 15:07:15`)
    clean = clean.replace(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+\s+\d{2}:\d{2}:\d{2}(\s+\d{4})?\s*/i, '');
    
    return clean;
  };

  // Active PIN mapping calculation
  const pinQueryResults = useMemo(() => {
    if (pinModel !== 'AS14') return [];
    return queryAs14Pin(pinCd, pinLane, pinType);
  }, [pinModel, pinCd, pinLane, pinType]);

  // Pre-analyze log for common prompts to make selection magical
  const detectedPrompts = useMemo(() => {
    if (!logContent) return [];
    const lines = logContent.split(/\r?\n/).slice(0, 3000); // sample first 3000 lines for prompt discovery
    const counts: Record<string, number> = {};
    
    // Patterns to capture typical command prompts ending in #, > or $
    // Captures user@host:/path# or host> or BCM.0> or user$
    const promptRegexes = [
      /^\s*([A-Za-z0-9_\-.~]+@[A-Za-z0-9_\-.]+:[^#$>]*[#$>])/,
      /^\s*([\w\-./\[\]]+[#$>])/
    ];
    
    lines.forEach(line => {
      const cleanLine = cleanLineTimestamp(line);
      for (const regex of promptRegexes) {
        const match = cleanLine.match(regex);
        if (match) {
          const raw = match[1];
          const trimmed = raw.trim();
          // Avoid matching just space/numbers or single symbols or typical timestamp prefixes
          if (trimmed.length > 1 && !/^\d+$/.test(trimmed) && !trimmed.startsWith('[')) {
            counts[trimmed] = (counts[trimmed] || 0) + 1;
          }
          break;
        }
      }
    });

    const allLines = logContent.split(/\r?\n/);
    
    return Object.entries(counts)
      .map(([prompt]) => {
        // Calculate exact valid command count for this option
        let pRegex: RegExp;
        try {
          const escaped = prompt.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          pRegex = new RegExp(`^\\s*${escaped}\\s*(.*)$`);
        } catch (e) {
          pRegex = /^[>$#]\s*(.*)$/;
        }
        
        let cmdCount = 0;
        let inContinualLine = false;
        let tempCommand = '';
        
        for (let i = 0; i < allLines.length; i++) {
          const line = allLines[i];
          const cleanLine = cleanLineTimestamp(line);
          
          if (inContinualLine && autoJoinContinuation) {
            const cleanLineTrim = cleanLine.trim();
            if (cleanLineTrim.endsWith('\\')) {
              tempCommand += ' ' + cleanLineTrim.slice(0, -1).trim();
            } else {
              tempCommand += ' ' + cleanLineTrim;
              if (!filterBlanks || tempCommand.trim()) {
                cmdCount++;
              }
              inContinualLine = false;
              tempCommand = '';
            }
          } else {
            const match = cleanLine.match(pRegex);
            if (match) {
              const fullCmd = match[1]?.trim() || '';
              if (filterBlanks && !fullCmd) {
                continue;
              }
              
              if (fullCmd.endsWith('\\') && autoJoinContinuation) {
                inContinualLine = true;
                tempCommand = fullCmd.slice(0, -1).trim();
              } else {
                cmdCount++;
              }
            }
          }
        }
        if (inContinualLine && tempCommand.trim()) {
          cmdCount++;
        }
        
        return { prompt, count: cmdCount };
      })
      .filter(item => item.count > 0) // only show prompts that actually extract valid commands
      .sort((a, b) => b.count - a.count)
      .slice(0, 5); // top 5 prompts
  }, [logContent, autoJoinContinuation, filterBlanks]);

  const activePrompt = useMemo(() => {
    if (customPromptEnabled) {
      return customPromptText.trim();
    }
    if (selectedPrompt) return selectedPrompt;
    if (detectedPrompts.length > 0) return detectedPrompts[0].prompt;
    return '^[>$#]'; // general fallback
  }, [customPromptEnabled, customPromptText, selectedPrompt, detectedPrompts]);

  interface ExtractedCommand {
    lineNum: number;
    command: string;
    rawLine: string;
    isCopied?: boolean;
  }

  const extractedCommands = useMemo<ExtractedCommand[]>(() => {
    if (!logContent || appMode !== 'all') return [];
    
    const lines = logContent.split(/\r?\n/);
    const result: ExtractedCommand[] = [];
    
    let pRegex: RegExp;
    try {
      if (!activePrompt) {
        pRegex = /^[>$#]\s*(.*)$/;
      } else if (activePrompt === '^[>$#]') {
        pRegex = /^[>$#]\s*(.*)$/;
      } else {
        // Escape standard string to prevent match crashes, unless they write regex
        const escaped = activePrompt.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        pRegex = new RegExp(`^\\s*${escaped}\\s*(.*)$`);
      }
    } catch (e) {
      pRegex = /^[>$#]\s*(.*)$/;
    }
    
    let inContinualLine = false;
    let tempCommand = '';
    let tempLineNum = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      const cleanLine = cleanLineTimestamp(line);
      
      if (inContinualLine && autoJoinContinuation) {
        const cleanLineTrim = cleanLine.trim();
        if (cleanLineTrim.endsWith('\\')) {
          tempCommand += ' ' + cleanLineTrim.slice(0, -1).trim();
        } else {
          tempCommand += ' ' + cleanLineTrim;
          if (!filterBlanks || tempCommand.trim()) {
            result.push({
              lineNum: tempLineNum,
              command: tempCommand.trim(),
              rawLine: line
            });
          }
          inContinualLine = false;
          tempCommand = '';
        }
      } else {
        const match = cleanLine.match(pRegex);
        if (match) {
          const fullCmd = match[1]?.trim() || '';
          if (filterBlanks && !fullCmd) {
            continue;
          }
          
          if (fullCmd.endsWith('\\') && autoJoinContinuation) {
            inContinualLine = true;
            tempCommand = fullCmd.slice(0, -1).trim();
            tempLineNum = lineNum;
          } else {
            result.push({
              lineNum,
              command: fullCmd,
              rawLine: line
            });
          }
        }
      }
    }
    
    // Handle outstanding continual lines at end of file
    if (inContinualLine && tempCommand.trim()) {
      result.push({
        lineNum: tempLineNum,
        command: tempCommand.trim(),
        rawLine: ''
      });
    }
    
    return result;
  }, [logContent, activePrompt, appMode, autoJoinContinuation, filterBlanks]);

  const filteredAllCommands = useMemo(() => {
    if (!allCommandsQuery.trim()) return extractedCommands;
    const query = allCommandsQuery.toLowerCase();
    return extractedCommands.filter(c => c.command.toLowerCase().includes(query));
  }, [extractedCommands, allCommandsQuery]);

  const copyAllCommandsToClipboard = () => {
    const text = extractedCommands.map(c => c.command).join('\n');
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const downloadAllCommands = () => {
    const text = extractedCommands.map(c => c.command).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const cleanFileName = fileName ? fileName.replace(/\.[^/.]+$/, "") : "session_commands";
    a.download = `${cleanFileName}_extracted_commands.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const addCommandPair = () => {
    setCommandPairs([...commandPairs, { id: crypto.randomUUID(), targetCommand: '', promptPattern: '' }]);
  };

  const removeCommandPair = (id: string) => {
    if (commandPairs.length > 1) {
      setCommandPairs(commandPairs.filter(p => p.id !== id));
    }
  };

  const updateCommandPair = (id: string, field: keyof CommandPair, value: string) => {
    setCommandPairs(commandPairs.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setLogContent(content);
    };
    reader.readAsText(file);
  };

  const clearFile = () => {
    setLogContent('');
    setFileName(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleProcess = () => {
    if (!logContent || commandPairs.every(p => !p.targetCommand.trim() && !p.promptPattern.trim())) return;

    const lines = logContent.split(/\r?\n/);
    const allExtracted: ExtractionResult[] = [];

    // Process each command pair independently
    commandPairs.forEach(pair => {
      const targetInput = pair.targetCommand.trim();
      const endInput = pair.promptPattern.trim();

      // Skip completely empty pairs (both target command and end pattern are empty)
      if (!targetInput && !endInput) return;

      // Case 1: Target Command is empty, but Ending pattern is configured:
      // Output every line from the start of file up to the line right before the ending pattern is matched.
      // If there are multiple matches, extract for each occurrence to let the user select the correct stop point.
      if (!targetInput && endInput) {
        let promptRegex: RegExp;
        try {
          promptRegex = new RegExp(endInput);
        } catch (e) {
          promptRegex = new RegExp(endInput.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
        }

        const matchIndices: number[] = [];
        for (let i = 0; i < lines.length; i++) {
          if (promptRegex.test(lines[i])) {
            matchIndices.push(i);
          }
        }

        if (matchIndices.length === 0) {
          return;
        }

        matchIndices.forEach((matchIdx, idxNo) => {
          const matchedLine = lines[matchIdx].trim();
          const displayMatchedLine = matchedLine.length > 50 ? matchedLine.slice(0, 47) + '...' : matchedLine;
          const gatheredOutput = lines.slice(0, matchIdx);
          allExtracted.push({
            lineNum: matchIdx + 1,
            command: `[选择停于第 ${idxNo + 1} 处匹配 (第 ${matchIdx + 1} 行): "${displayMatchedLine}"] ➔ 提取 ${gatheredOutput.length} 行`,
            output: gatheredOutput,
            pairId: pair.id
          });
        });
        return;
      }

      // Case 2: Target Command is present, ending pattern may or may not be empty (existing standard behavior with fuzzy match)
      const keywords = targetInput.toLowerCase().split(/\s+/).filter(k => k.length > 0);

      let current: ExtractionResult | null = null;
      let promptRegex: RegExp;
      try {
        // If empty, use a default common prompt pattern
        promptRegex = new RegExp(endInput || '^[>$#]');
      } catch (e) {
        promptRegex = /^[>$#]/;
      }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;
        const lowerLine = line.toLowerCase();

        // Check if all keywords are present in the line
        const isMatch = keywords.every(kw => lowerLine.includes(kw));

        if (isMatch) {
          if (current) {
            allExtracted.push(current);
          }
          current = {
            lineNum,
            command: line,
            output: [],
            pairId: pair.id
          };
        } else if (current) {
          if (promptRegex.test(line)) {
            allExtracted.push(current);
            current = null;
          } else {
            current.output.push(line);
          }
        }
      }
      if (current) {
        allExtracted.push(current);
      }
    });

    // Sort by line number globally
    setResults(allExtracted.sort((a, b) => a.lineNum - b.lineNum));
    // Reset expanded groups and results on new process
    setExpandedGroups(new Set());
    setExpandedResults(new Set());
  };

  const toggleGroup = (id: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedGroups(newExpanded);
  };

  const toggleResult = (pairId: string, lineNum: number) => {
    const key = `${pairId}-${lineNum}`;
    const newExpanded = new Set(expandedResults);
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedResults(newExpanded);
  };

  const groupedResults = useMemo(() => {
    if (!results) return null;
    const groups: Record<string, ExtractionResult[]> = {};
    results.forEach(res => {
      if (!groups[res.pairId]) groups[res.pairId] = [];
      groups[res.pairId].push(res);
    });
    return groups;
  }, [results]);

  const getResultTextForPair = (pairId: string) => {
    const pairResults = groupedResults?.[pairId];
    if (!pairResults) return '';
    const pair = commandPairs.find(p => p.id === pairId);
    return pairResults.map(res => {
      return `[行号${res.lineNum}] ${res.command}\n${res.output.join('\n')}`;
    }).join('\n\n');
  };

  const copyPairToClipboard = (pairId: string) => {
    const text = getResultTextForPair(pairId);
    navigator.clipboard.writeText(text);
    // Local feedback could be added here, but for now we'll use a simple alert or just rely on the icon change if we track per-pair
  };

  const downloadPairResult = (pairId: string) => {
    const text = getResultTextForPair(pairId);
    const pair = commandPairs.find(p => p.id === pairId);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    const safeName = pair?.targetCommand.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'result';
    
    let finalFileName = '';
    const trimmedInput = customExportName.trim();
    if (trimmedInput) {
      let baseName = trimmedInput.replace(/\.log$/i, '');
      const activePairs = commandPairs.filter(p => p.targetCommand.trim() || p.promptPattern.trim());
      if (activePairs.length > 1) {
        finalFileName = `${baseName}_${safeName}.log`;
      } else {
        finalFileName = `${baseName}.log`;
      }
    } else {
      finalFileName = `提取结果_${safeName}.log`;
    }
    
    a.download = finalFileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copySingleResultToClipboard = (res: ExtractionResult) => {
    const text = `[行号${res.lineNum}] ${res.command}\n${res.output.join('\n')}`;
    navigator.clipboard.writeText(text);
    const itemKey = `${res.pairId}-${res.lineNum}`;
    setCopiedItemKey(itemKey);
    setTimeout(() => setCopiedItemKey(null), 2000);
  };

  const downloadSingleResult = (res: ExtractionResult) => {
    const text = `[行号${res.lineNum}] ${res.command}\n${res.output.join('\n')}`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    let finalFileName = '';
    const trimmedInput = customExportName.trim();
    // Neutralize any special characters for command name to use in filename safely
    const safeCommandStr = res.command.replace(/[^a-z0-9_\u4e00-\u9fa5]/gi, '_').toLowerCase().slice(0, 30);
    if (trimmedInput) {
      let baseName = trimmedInput.replace(/\.log$/i, '');
      finalFileName = `${baseName}_L${res.lineNum}.log`;
    } else {
      finalFileName = `提取项_L${res.lineNum}_${safeCommandStr}.log`;
    }
    
    a.download = finalFileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resultText = useMemo(() => {
    if (!results) return '';
    if (results.length === 0) return '未在日志中找到目标命令';

    return results.map(res => {
      const pair = commandPairs.find(p => p.id === res.pairId);
      const label = pair ? `[匹配关键字: ${pair.targetCommand || `从文件开头至${pair.promptPattern}`}] ` : '';
      return `${label}[行号${res.lineNum}] ${res.command}\n${res.output.join('\n')}`;
    }).join('\n\n');
  }, [results, commandPairs]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(resultText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadAllSeparately = () => {
    if (!groupedResults) return;
    
    const pairIds = Object.keys(groupedResults);
    if (pairIds.length === 0) return;

    pairIds.forEach((pairId, index) => {
      // Small delay between downloads to prevent browser blocking
      setTimeout(() => {
        downloadPairResult(pairId);
      }, index * 300);
    });
  };

  // ==========================================================
  // BRAND NEW: Fault Location Analytics and Helper Event Handlers
  // ==========================================================
  interface FaultMatch {
    lineNum: number;
    matchText: string;
    contextBefore: string[];
    contextAfter: string[];
    ltState: 'ON' | 'OFF' | 'UNKNOWN';
    foundPhyDiag?: boolean;
    reachedStart?: boolean;
  }

  interface PortStatusInfo {
    port: string;
    state: 'UP' | 'DOWN';
    lineNum: number;
    rawLine: string;
    phyPort?: string;
  }

  interface FaultAnalysisResult {
    productModel: string;
    productModelSource: string;
    productModelLine: number | null;
    sdkVersion: string | null;
    sdkVersionLine: number | null;
    ucStsMatches: FaultMatch[];
    ltOffPorts: PortStatusInfo[];
    ltOnPorts: PortStatusInfo[];
    ltOffUpPorts: string[];
    ltOnUpPorts: string[];
  }

  const faultAnalysis = useMemo<FaultAnalysisResult>(() => {
    if (!logContent) {
      return { 
        productModel: "UNKNOWN",
        productModelSource: "",
        productModelLine: null,
        sdkVersion: null,
        sdkVersionLine: null,
        ucStsMatches: [], 
        ltOffPorts: [], 
        ltOnPorts: [], 
        ltOffUpPorts: [], 
        ltOnUpPorts: [] 
      };
    }
    
    const lines = logContent.split(/\r?\n/);
    let productModel = "UNKNOWN";
    let productModelSource = "";
    let productModelLine: number | null = null;
    let sdkVersion: string | null = null;
    let sdkVersionLine: number | null = null;
    
    // Helper to determine active Link Training state at a given line number index
    const getLTStateAtLine = (targetIdx: number, allLines: string[]): 'ON' | 'OFF' | 'UNKNOWN' => {
      // Search backward from the fault point to the first line of the file (sequential log behavior)
      for (let j = targetIdx; j >= 0; j--) {
        const line = allLines[j];
        if (/link_training\s*=\s*0|link_training\s*:\s*0/i.test(line)) {
          return 'OFF';
        }
        if (/link_training\s*=\s*1|link_training\s*:\s*1/i.test(line)) {
          return 'ON';
        }
      }
      // According to guidelines, if no LINK_TRAINING configuration is found from the beginning
      // of the file up to this fault point, default/regore the state to LT OFF ('OFF').
      return 'OFF';
    };

    // Helper to cleanse the extracted product model
    const cleanModelString = (str: string): string => {
      let cleaned = str.trim();
      // Remove x86_64- prefix
      cleaned = cleaned.replace(/^x86_64-/i, '');
      // Remove -r0 suffix (-r\d+)
      cleaned = cleaned.replace(/-r\d+$/i, '');
      return cleaned;
    };
    
    // 1. Product Model extraction
    // First scan: prioritize PRODUCT NAME directly
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/\bproduct[-_]?name\s*[:=]\s*([^\r\n]+)/i);
      if (match) {
        let val = match[1].trim();
        val = val.replace(/^["']|["']$/g, '').trim();
        if (val) {
          productModel = cleanModelString(val);
          productModelSource = "PRODUCT NAME 直接字段";
          productModelLine = i + 1;
          break;
        }
      }
    }

    // Secondary scan: if still unknown, search for alternative fields
    if (productModel === "UNKNOWN") {
      let onieMachine: string | null = null;
      let onieMachineLine: number | null = null;
      let oniePlatform: string | null = null;
      let oniePlatformLine: number | null = null;
      let dmiProduct: string | null = null;
      let dmiProductLine: number | null = null;
      let fallbackChip: string | null = null;
      let fallbackChipLine: number | null = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // 1) onie_machine / onie_build_machine
        const machineMatch = line.match(/\bonie_(?:build_)?machine\s*=\s*([^\s;]+)/i);
        if (machineMatch) {
          onieMachine = machineMatch[1].trim();
          onieMachineLine = i + 1;
        }

        // 2) onie_platform
        const platformMatch = line.match(/\bonie_platform\s*=\s*([^\s;]+)/i);
        if (platformMatch) {
          oniePlatform = platformMatch[1].trim();
          oniePlatformLine = i + 1;
        }

        // 3) Board Product Name or baseboard/product etc.
        const dmiMatch = line.match(/\b(board|baseboard|product|board[-_]?name)\s*product\s*name\s*[:=]\s*([^\r\n]+)/i) 
          || line.match(/\bboard\s*name\s*[:=]\s*([^\r\n]+)/i)
          || line.match(/\bproduct\s*model\s*[:=]\s*([^\r\n]+)/i);
        if (dmiMatch) {
          let val = dmiMatch[dmiMatch.length - 1].trim();
          val = val.replace(/^["']|["']$/g, '').trim();
          if (val) {
            dmiProduct = val;
            dmiProductLine = i + 1;
          }
        }

        // 4) Chip model fallback (lowest confidence)
        const chipMatch = line.match(/\b(bcm\d{4,5}[a-zA-Z0-9]*|trident\s*[34]|tomahawk\s*[34]?)\b/i);
        if (chipMatch && !fallbackChip) {
          fallbackChip = chipMatch[1].trim().toUpperCase();
          fallbackChipLine = i + 1;
        }
      }

      // Priority ordering for fallback assignment
      if (onieMachine) {
        productModel = cleanModelString(onieMachine);
        productModelSource = "onie_machine 字段推断";
        productModelLine = onieMachineLine;
      } else if (oniePlatform) {
        productModel = cleanModelString(oniePlatform);
        productModelSource = "onie_platform 字段推断";
        productModelLine = oniePlatformLine;
      } else if (dmiProduct) {
        productModel = cleanModelString(dmiProduct);
        productModelSource = "DMI设备树或主板信息提取";
        productModelLine = dmiProductLine;
      } else if (fallbackChip) {
        productModel = `${fallbackChip} 系列`;
        productModelSource = "芯片型号推断 (最低可信度)";
        productModelLine = fallbackChipLine;
      }
    }

    productModel = productModel.toUpperCase();

    // 1b. Broadcom SDK version extraction (case-insensitive)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/release:\s*sdk-([^\s]+)/i);
      if (match) {
        sdkVersion = match[1];
        sdkVersionLine = i + 1;
        break;
      }
    }
    
    // 2. uc_sts / uc_sts_ext BIT keywords matching
    const ucStsMatches: FaultMatch[] = [];
    const ucStsRegex = /uc_sts(_ext)?\s+BIT/i;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (ucStsRegex.test(line)) {
        // Collect upwards: search to find nearest "dsh -c 'phy diag" command (inclusive)
        let startIdx = -1;
        let foundPhyDiag = false;
        for (let j = i - 1; j >= 0; j--) {
          const lLower = lines[j].toLowerCase();
          if (lLower.includes("dsh -c 'phy diag") || /dsh\s+-c\s+['"]phy\s+diag/i.test(lines[j])) {
            startIdx = j;
            foundPhyDiag = true;
            break;
          }
        }
        
        let reachedStart = false;
        if (startIdx === -1) {
          startIdx = Math.max(0, i - 6);
          if (startIdx === 0) {
            reachedStart = true;
          }
        }

        const endIdx = Math.min(lines.length - 1, i + 6);
        
        const contextBefore = lines.slice(startIdx, i);
        const contextAfter = lines.slice(i + 1, endIdx + 1);
        const ltState = getLTStateAtLine(i, lines);
        
        ucStsMatches.push({
          lineNum: i + 1,
          matchText: line,
          contextBefore,
          contextAfter,
          ltState,
          foundPhyDiag,
          reachedStart
        });
      }
    }

    // 3. Sequential Port Status & Link State tracking relative to current Link Training (LT) configuration
    let currentLtState: 'ON' | 'OFF' = 'OFF';
    const ltOffMap = new Map<string, PortStatusInfo>();
    const ltOnMap = new Map<string, PortStatusInfo>();

    // For parsing dynamic switch ps tables
    let activeHeaders: string[] | null = null;
    let portHeaderIndex = -1;
    let linkHeaderIndex = -1;
    let phyHeaderIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Update current Link Training state on configuration line
      if (/link_training\s*=\s*1|link_training\s*:\s*1/i.test(line)) {
        currentLtState = 'ON';
      } else if (/link_training\s*=\s*0|link_training\s*:\s*0/i.test(line)) {
        currentLtState = 'OFF';
      }

      const cleanLine = cleanLineTimestamp(line).trim();

      // Check if it's a table header line for port status (e.g., from bcm diagnostic tables)
      if (/\b(?:port|intf|interface)\b/i.test(cleanLine) && /\b(?:link|status|lnk|up\/down)\b/i.test(cleanLine)) {
        const headerCols = cleanLine.split(/\s+/);
        // Identify indexes
        portHeaderIndex = headerCols.findIndex(c => /^(port|intf|interface)$/i.test(c));
        linkHeaderIndex = headerCols.findIndex(c => /^(link|status|lnk|up\/down|link_status)$/i.test(c));
        phyHeaderIndex = headerCols.findIndex(c => /^(phy|phyid|physical|phy_id|unit|phy-id)$/i.test(c));
        activeHeaders = headerCols;
        continue; // Skip matching header line itself
      }

      // Scan for port and link status
      let matchedPort: string | null = null;
      let matchedState: 'UP' | 'DOWN' | null = null;
      let matchedPhy: string | null = null;

      // First approach: if headers matched previously, we parse as columns
      if (activeHeaders && cleanLine && !cleanLine.startsWith('=') && !cleanLine.startsWith('-')) {
        const columns = cleanLine.split(/\s+/);
        if (columns.length >= Math.max(portHeaderIndex, linkHeaderIndex) + 1) {
          const portCandidate = columns[portHeaderIndex];
          const linkCandidate = columns[linkHeaderIndex];
          
          if (portCandidate && linkCandidate && /^(up|down)$/i.test(linkCandidate)) {
            let phyVal = '';
            if (phyHeaderIndex !== -1 && columns[phyHeaderIndex]) {
              phyVal = columns[phyHeaderIndex];
            } else {
              // Try to find physical port inside parentheses in portCandidate (e.g., xe0(1) -> 1)
              const parenMatch = portCandidate.match(/\((\d+)\)/) || portCandidate.match(/phy\s*(\d+)/i);
              if (parenMatch) {
                phyVal = parenMatch[1];
              }
            }
            const cleanPortName = portCandidate.replace(/\s*\(.*?\)/g, '');
            if (cleanPortName && !/^(port|intf|interface|stp|state|speed|duplex|discard|lrn|pause)$/i.test(cleanPortName)) {
              matchedPort = cleanPortName;
              matchedState = linkCandidate.toUpperCase() as 'UP' | 'DOWN';
              matchedPhy = phyVal || null;
            }
          }
        }
      }

      // Fallback: loose line patterns or non-tabular logs listing port link states
      if (!matchedPort) {
        // Class A Match: paren port syntax: xe0(1) OR xe0(phy 1) UP
        let match = cleanLine.match(/\b([\w\-\/]+)\s*\(\s*(?:phy\s+)?(\d+)\s*\)\s+(?:link\s+(?:is\s+)?)?(up|down)\b/i);
        if (match) {
          matchedPort = match[1];
          matchedPhy = match[2];
          matchedState = match[3].toUpperCase() as 'UP' | 'DOWN';
        } else {
          // Class B Match: port <identity> [is] link [is] up/down
          match = cleanLine.match(/\bports?\s+([\w\-\/]+)\s+(?:link\s+is\s+|link\s+state\s+|link\s+|is\s+)?(up|down)\b/i);
          if (match) {
            matchedPort = match[1];
            matchedState = match[2].toUpperCase() as 'UP' | 'DOWN';
          } else {
            // Class C Match: <identity>: link is up/down
            match = cleanLine.match(/\b([\w\-\/]+)\s*:\s*link\s+(?:is\s+)?(up|down)\b/i);
            if (match) {
              matchedPort = match[1];
              matchedState = match[2].toUpperCase() as 'UP' | 'DOWN';
            } else {
              // Class D Match: link up/down on port <identity>
              match = cleanLine.match(/\blink\s+(up|down)\s+on\s+(?:ports?\s+)?([\w\-\/]+)\b/i);
              if (match) {
                matchedPort = match[2];
                matchedState = match[1].toUpperCase() as 'UP' | 'DOWN';
              } else {
                // Class E Match: xe0 link up / ge12 link down
                match = cleanLine.match(/\b(xe\d+|ge\d+|te\d+|ce\d+|port\s*\d+|eth\d+|hg\d+)\s+link\s+(?:is\s+)?(up|down)\b/i);
                if (match) {
                  matchedPort = match[1];
                  matchedState = match[2].toUpperCase() as 'UP' | 'DOWN';
                }
              }
            }
          }
        }
      }

      // Class F table-like line matching without active headers: "xe0 10G FD up [phy_port_num]"
      if (!matchedPort) {
        const columns = cleanLine.split(/\s+/);
        if (columns.length >= 2) {
          const firstCol = columns[0];
          // Check if first column mimics a port identifier
          if (/^(?:xe|ge|te|ce|eth|hg|port|ethernet)\d+/i.test(firstCol) || /^[a-z]+\d+(?:\/\d+)*$/i.test(firstCol)) {
            const linkIdx = columns.findIndex(col => /^(up|down)$/i.test(col));
            if (linkIdx !== -1) {
              matchedPort = firstCol;
              matchedState = columns[linkIdx].toUpperCase() as 'UP' | 'DOWN';
              // Look for the physical port number which is usually a lone integer in other columns
              for (let k = columns.length - 1; k > linkIdx; k--) {
                if (/^\d+$/.test(columns[k])) {
                  matchedPhy = columns[k];
                  break;
                }
              }
            }
          }
        }
      }

      // If any of the above paths successfully identified a port link state record
      if (matchedPort && matchedState) {
        const cleanPort = matchedPort.trim();
        const nonPortKeywords = /^(state|no|is|the|all|link|channel|status|mode)$/i;
        if (!nonPortKeywords.test(cleanPort)) {
          // If phy wasn't matched explicitly, check if the cleanPort name contains parenthesis mapping like "xe0(5)"
          if (!matchedPhy) {
            const parenMatch = cleanPort.match(/\((\d+)\)/) || cleanPort.match(/phy\s*(\d+)/i);
            if (parenMatch) {
              matchedPhy = parenMatch[1];
            }
          }
          const cleanPortName = cleanPort.replace(/\s*\(.*?\)/g, '');
          const portInfo: PortStatusInfo = {
            port: cleanPortName,
            state: matchedState,
            lineNum,
            rawLine: line,
            phyPort: matchedPhy || undefined
          };
          if (currentLtState === 'OFF') {
            ltOffMap.set(cleanPortName, portInfo);
          } else {
            ltOnMap.set(cleanPortName, portInfo);
          }
        }
      }
    }

    // Sort helper to sort ports naturally (e.g., xe2 before xe10)
    const sortPorts = (a: PortStatusInfo, b: PortStatusInfo) => {
      return a.port.localeCompare(b.port, undefined, { numeric: true, sensitivity: 'base' });
    };

    const ltOffPorts = Array.from(ltOffMap.values()).sort(sortPorts);
    const ltOnPorts = Array.from(ltOnMap.values()).sort(sortPorts);

    const ltOffUpPorts = ltOffPorts.filter(p => p.state === 'UP').map(p => p.port);
    const ltOnUpPorts = ltOnPorts.filter(p => p.state === 'UP').map(p => p.port);
    
    return { 
      productModel, 
      productModelSource,
      productModelLine,
      sdkVersion,
      sdkVersionLine,
      ucStsMatches, 
      ltOffPorts, 
      ltOnPorts, 
      ltOffUpPorts, 
      ltOnUpPorts 
    };
  }, [logContent]);

  const getFaultReportText = () => {
    if (!logContent) return '请上传日志后再生成分析报告';
    const { productModel, productModelSource, productModelLine, sdkVersion, sdkVersionLine, ucStsMatches } = faultAnalysis;
    
    const ltOffMatches = ucStsMatches.filter(m => m.ltState === 'OFF');
    const ltOnMatches = ucStsMatches.filter(m => m.ltState === 'ON');
    const ltUnknownMatches = ucStsMatches.filter(m => m.ltState === 'UNKNOWN');
    
    let report = `==================================================\n`;
    report += `      高价值芯片故障定位及诊断分析报告\n`;
    report += `==================================================\n\n`;
    
    report += `[基础诊断指标]\n`;
    report += `- 日志源文件名: ${fileName || '未知'}\n`;
    report += `- 诊断扫描时间: ${new Date().toLocaleString()}\n`;
    report += `- 产品型号: ${productModel}\n`;
    if (productModelSource) {
      report += `- 产品型号来源: ${productModelSource}${productModelLine ? ` (调试日志第 L${productModelLine} 行)` : ''}\n`;
    }
    report += `- Broadcom SDK 固件版本: ${sdkVersion ? `SDK-${sdkVersion}` : '未找到 SDK 版本'}\n`;
    if (sdkVersion && sdkVersionLine) {
      report += `- Broadcom SDK 提取位置: 第 L${sdkVersionLine} 行\n`;
    }
    report += `- uc_sts (SerDes状态) BIT总发生数: ${ucStsMatches.length} 处\n`;
    report += `  - 其中 LT OFF (Link Training) 干扰状态故障数: ${ltOffMatches.length} 处\n`;
    report += `  - 其中 LT ON (Link Training) 干扰状态故障数: ${ltOnMatches.length} 处\n`;
    if (ltUnknownMatches.length > 0) {
      report += `  - 其中 未标明 LT 状态的环境故障数: ${ltUnknownMatches.length} 处\n`;
    }
    report += `\n`;
    
    report += `==================================================\n`;
    report += `[故障异常详细上下文追溯记录 (按 Link Training 整合分类)]\n`;
    report += `==================================================\n\n`;
    
    if (ucStsMatches.length === 0) {
      report += `[扫描通过] 未在日志中检索到任何 uc_sts / uc_sts_ext 相关寄存器或者电平或状态位异常告警。\n`;
    } else {
      // 1. LT OFF Group
      report += `>>> ---------------------------------------------\n`;
      report += `>>> 【LT OFF 模式】芯片异常捕获段 (共检测到 ${ltOffMatches.length} 处)\n`;
      report += `>>> ---------------------------------------------\n`;
      if (ltOffMatches.length === 0) {
        report += `[如实报告] 日志周期内未检索到任何在 LT OFF (Link Training: 0) 触发的 uc_sts 运行异常位。\n\n`;
      } else {
        ltOffMatches.forEach((match, idx) => {
          report += `--- LT OFF 状态 - 第 ${idx + 1} 处异常关联信息 (行号: L${match.lineNum}) ---\n`;
          const beforeLen = match.contextBefore.length;
          if (beforeLen < 6 && !match.foundPhyDiag) {
            report += `[边界提示: 日志顶部已触顶，上方实际记录少于 6 行，并且未找到相关的 dsh -c 'phy diag 命令]\n`;
          }
          match.contextBefore.forEach((line, bIdx) => {
            const actualLineNum = match.lineNum - beforeLen + bIdx;
            report += `L${actualLineNum}: ${line}\n`;
          });
          report += `L${match.lineNum} [!!! 匹配异常主行]: ${match.matchText}\n`;
          match.contextAfter.forEach((line, aIdx) => {
            const actualLineNum = match.lineNum + 1 + aIdx;
            report += `L${actualLineNum}: ${line}\n`;
          });
          const afterLen = match.contextAfter.length;
          if (afterLen < 6) {
            report += `[边界提示: 日志底部已触底，下方实际记录少于 6 行]\n`;
          }
          report += `\n`;
        });
      }

      // 2. LT ON Group
      report += `>>> ---------------------------------------------\n`;
      report += `>>> 【LT ON 模式】芯片异常捕获段 (共检测到 ${ltOnMatches.length} 处)\n`;
      report += `>>> ---------------------------------------------\n`;
      if (ltOnMatches.length === 0) {
        report += `[如实报告] 日志周期内未检索到任何在 LT ON (Link Training: 1) 触发的 uc_sts 运行异常位。\n\n`;
      } else {
        ltOnMatches.forEach((match, idx) => {
          report += `--- LT ON 状态 - 第 ${idx + 1} 处异常关联信息 (行号: L${match.lineNum}) ---\n`;
          const beforeLen = match.contextBefore.length;
          if (beforeLen < 6 && !match.foundPhyDiag) {
            report += `[边界提示: 日志顶部已触顶，上方实际记录少于 6 行，并且未找到相关的 dsh -c 'phy diag 命令]\n`;
          }
          match.contextBefore.forEach((line, bIdx) => {
            const actualLineNum = match.lineNum - beforeLen + bIdx;
            report += `L${actualLineNum}: ${line}\n`;
          });
          report += `L${match.lineNum} [!!! 匹配异常主行]: ${match.matchText}\n`;
          match.contextAfter.forEach((line, aIdx) => {
            const actualLineNum = match.lineNum + 1 + aIdx;
            report += `L${actualLineNum}: ${line}\n`;
          });
          const afterLen = match.contextAfter.length;
          if (afterLen < 6) {
            report += `[边界提示: 日志底部已触底，下方实际记录少于 6 行]\n`;
          }
          report += `\n`;
        });
      }

      // 3. UNKNOWN Group (optional/honest fallback)
      if (ltUnknownMatches.length > 0) {
        report += `>>> ---------------------------------------------\n`;
        report += `>>> 【未标明 Link Training 状态】芯片异常捕获段 (共检测到 ${ltUnknownMatches.length} 处)\n`;
        report += `>>> ---------------------------------------------\n`;
        ltUnknownMatches.forEach((match, idx) => {
          report += `--- 未识别 LT 状态 - 第 ${idx + 1} 处异常关联信息 (行号: L${match.lineNum}) ---\n`;
          const beforeLen = match.contextBefore.length;
          if (beforeLen < 6 && !match.foundPhyDiag) {
            report += `[边界提示: 日志顶部已触顶，上方实际记录少于 6 行，并且未找到相关的 dsh -c 'phy diag 命令]\n`;
          }
          match.contextBefore.forEach((line, bIdx) => {
            const actualLineNum = match.lineNum - beforeLen + bIdx;
            report += `L${actualLineNum}: ${line}\n`;
          });
          report += `L${match.lineNum} [!!! 匹配异常主行]: ${match.matchText}\n`;
          match.contextAfter.forEach((line, aIdx) => {
            const actualLineNum = match.lineNum + 1 + aIdx;
            report += `L${actualLineNum}: ${line}\n`;
          });
          const afterLen = match.contextAfter.length;
          if (afterLen < 6) {
            report += `[边界提示: 日志底部已触底，下方实际记录少于 6 行]\n`;
          }
          report += `\n`;
        });
      }
    }

    // 3. Port Link Status and separation diagnostics
    const { ltOffPorts, ltOnPorts, ltOffUpPorts, ltOnUpPorts } = faultAnalysis;
    
    report += `==================================================\n`;
    report += `三、各端口 Link 状态探测及 Link Training (LT) 分离分析\n`;
    report += `==================================================\n\n`;
    
    report += `【LT OFF (Link Training 关闭) 下的端口状态汇总】:\n`;
    if (ltOffPorts.length === 0) {
      report += `  - [未侦测记录] 日志期间未探测到任何处于 LT OFF 状态下的端口 Link 状态发生变迁。\n`;
    } else {
      report += `  - 处于 UP 状态的端口数量: ${ltOffUpPorts.length} 个\n`;
      report += `  - 处于 UP 状态的端口列表: ${ltOffUpPorts.length > 0 ? ltOffUpPorts.map(pName => {
        const pObj = ltOffPorts.find(x => x.port === pName);
        return pObj && pObj.phyPort ? `${pName}(PHY ${pObj.phyPort})` : pName;
      }).join(', ') : '无'}\n`;
      report += `  - 详细端口状态列表:\n`;
      ltOffPorts.forEach(p => {
        report += `    * ${p.port}${p.phyPort ? ` (物理端口 ID: ${p.phyPort})` : ''}: ${p.state} (记录于 L${p.lineNum})\n`;
      });
    }
    report += `\n`;
    
    report += `【LT ON (Link Training 开启) 下的端口状态汇总】:\n`;
    if (ltOnPorts.length === 0) {
      report += `  - [未侦测记录] 日志期间未探测到任何处于 LT ON 状态下的端口 Link 状态发生变迁。\n`;
    } else {
      report += `  - 处于 UP 状态的端口数量: ${ltOnUpPorts.length} 个\n`;
      report += `  - 处于 UP 状态的端口列表: ${ltOnUpPorts.length > 0 ? ltOnUpPorts.map(pName => {
        const pObj = ltOnPorts.find(x => x.port === pName);
        return pObj && pObj.phyPort ? `${pName}(PHY ${pObj.phyPort})` : pName;
      }).join(', ') : '无'}\n`;
      report += `  - 详细端口状态列表:\n`;
      ltOnPorts.forEach(p => {
        report += `    * ${p.port}${p.phyPort ? ` (物理端口 ID: ${p.phyPort})` : ''}: ${p.state} (记录于 L${p.lineNum})\n`;
      });
    }
    report += `\n`;

    return report;
  };

  const copyFaultReportToClipboard = () => {
    const report = getFaultReportText();
    navigator.clipboard.writeText(report);
    setCopiedFaultReport(true);
    setTimeout(() => setCopiedFaultReport(false), 2000);
  };

  const downloadFaultReport = () => {
    const report = getFaultReportText();
    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    const trimmedInput = customExportName.trim();
    let finalFileName = '';
    if (trimmedInput) {
      finalFileName = `${trimmedInput.replace(/\.log$/i, '')}.log`;
    } else {
      const cleanFileName = fileName ? fileName.replace(/\.[^/.]+$/, "") : "fault_diagnostic";
      finalFileName = `${cleanFileName}_fault_location_report.log`;
    }
    
    a.download = finalFileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleAllFaultMatches = (expand: boolean) => {
    if (expand) {
      const allNums = faultAnalysis.ucStsMatches.map(m => m.lineNum);
      setExpandedFaultMatches(new Set(allNums));
    } else {
      setExpandedFaultMatches(new Set());
    }
  };

  const copySingleFaultMatchToClipboard = (match: FaultMatch) => {
    let text = `[行号 L${match.lineNum}] ${match.matchText}\n`;
    text += `-------- 上文 6 行 --------\n`;
    text += match.contextBefore.join('\n') + '\n';
    text += `-------- 异常匹配主行 --------\n`;
    text += `=> ${match.matchText}\n`;
    text += `-------- 下文 6 行 --------\n`;
    text += match.contextAfter.join('\n');
    navigator.clipboard.writeText(text);
    setCopiedSingleMatch(String(match.lineNum));
    setTimeout(() => setCopiedSingleMatch(null), 2000);
  };

  const downloadSingleFaultMatch = (match: FaultMatch) => {
    let text = `[异常行 L${match.lineNum}] ${match.matchText}\n`;
    text += `-------- 上文 6 行 --------\n`;
    text += match.contextBefore.join('\n') + '\n';
    text += `-------- 异常匹配主行 --------\n`;
    text += match.matchText + '\n';
    text += `-------- 下文 6 行 --------\n`;
    text += match.contextAfter.join('\n');
    
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `uc_sts_L${match.lineNum}_fault_context.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-[#1d1d1f] font-sans selection:bg-[#0071e3] selection:text-white">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 h-14 bg-white/90 backdrop-blur-md border-b border-black/5 z-50 flex items-center justify-between px-6">
        <div className="flex items-center gap-3 shrink-0 z-10">
          <div className="flex items-center justify-center bg-[#1d1d1f] text-white rounded-xl p-1.5 shadow-sm">
            <Cpu className="w-4 h-4" />
          </div>
          <div className="flex items-center gap-2">
            <h1 className="text-[15px] md:text-[16px] font-semibold text-[#1d1d1f] tracking-tight">
              高价值芯片故障日志收集
            </h1>
            <span className="text-[10px] text-[#86868b] font-medium bg-[#f5f5f7] px-2 py-0.5 rounded-full border border-black/[0.06] font-mono">
              v1.0.0
            </span>
          </div>
        </div>

        {/* Mode Switcher */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#f5f5f7] p-0.5 rounded-full border border-black/5 flex items-center shadow-inner z-0">
          <button
            onClick={() => setAppMode('all')}
            className={`px-3 py-1 text-[11px] font-semibold rounded-full min-w-[95px] md:min-w-[115px] text-center transition-all cursor-pointer relative z-10 ${
              appMode === 'all' ? 'text-[#1d1d1f]' : 'text-[#86868b] hover:text-[#1d1d1f]'
            }`}
          >
            脚本指令提取
            {appMode === 'all' && (
              <motion.div 
                layoutId="activeSubmode"
                className="absolute inset-0 bg-white rounded-full -z-10 shadow-sm border border-black/[0.02]"
                transition={{ type: 'spring', stiffness: 350, damping: 25 }}
              />
            )}
          </button>
          <button
            onClick={() => setAppMode('targeted')}
            className={`px-3 py-1 text-[11px] font-semibold rounded-full min-w-[95px] md:min-w-[115px] text-center transition-all cursor-pointer relative z-10 ${
              appMode === 'targeted' ? 'text-[#1d1d1f]' : 'text-[#86868b] hover:text-[#1d1d1f]'
            }`}
          >
            故障日志收集
            {appMode === 'targeted' && (
              <motion.div 
                layoutId="activeSubmode"
                className="absolute inset-0 bg-white rounded-full -z-10 shadow-sm border border-black/[0.02]"
                transition={{ type: 'spring', stiffness: 350, damping: 25 }}
              />
            )}
          </button>
          <button
            onClick={() => setAppMode('fault')}
            className={`px-3 py-1 text-[11px] font-semibold rounded-full min-w-[95px] md:min-w-[115px] text-center transition-all cursor-pointer relative z-10 ${
              appMode === 'fault' ? 'text-[#1d1d1f]' : 'text-[#86868b] hover:text-[#1d1d1f]'
            }`}
          >
            故障内容定位
            {appMode === 'fault' && (
              <motion.div 
                layoutId="activeSubmode"
                className="absolute inset-0 bg-white rounded-full -z-10 shadow-sm border border-black/[0.02]"
                transition={{ type: 'spring', stiffness: 350, damping: 25 }}
              />
            )}
          </button>
        </div>

        <div className="flex items-center gap-4 shrink-0 z-10">
          {appMode === 'targeted' ? (
            <button 
              onClick={handleProcess}
              disabled={!logContent || commandPairs.every(p => !p.targetCommand.trim() && !p.promptPattern.trim())}
              className="px-4 py-1.5 bg-[#0071e3] text-white text-[12px] font-semibold rounded-full hover:bg-[#0077ed] disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <Terminal className="w-3.5 h-3.5" />
              处理日志
            </button>
          ) : appMode === 'fault' ? (
            logContent ? (
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="flex items-center gap-2 px-3 py-1 bg-[#f0f4f9] border border-[#0071e3]/10 text-[#0071e3] text-[11px] font-bold rounded-full shadow-sm"
                title="已扫描分析：自动检索 Broadcom SDK 版本及 SerDes 模块 uc_sts 运行时异常状态"
              >
                <div className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#0071e3]"></span>
                </div>
                <Sparkles className="w-3 h-3" />
                <span>异常故障实时分析中</span>
              </motion.div>
            ) : (
              <div 
                className="flex items-center gap-2 px-3 py-1 bg-[#f5f5f7] border border-black/5 text-[#86868b] text-[11px] font-semibold rounded-full"
                title="等待上载：请在一侧拖放或选择交换机调试日志，右侧将全自动完成固件及位异常的就地解析"
              >
                <div className="h-1.5 w-1.5 rounded-full bg-gray-300"></div>
                <Sparkles className="w-3 h-3 opacity-60" />
                <span>芯片异常探针已就绪</span>
              </div>
            )
          ) : (
            logContent ? (
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="flex items-center gap-2 px-3 py-1 bg-[#e3f9e5] border border-[#24a148]/10 text-[#24a148] text-[11px] font-bold rounded-full shadow-sm"
                title="已就绪：无需按键，当上传或更改日志/匹配前缀后，将由系统在背景进程自动、实时高响应过滤并更新展示结果"
              >
                <div className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#24a148]"></span>
                </div>
                <Sparkles className="w-3 h-3" />
                <span>自动实时分析中</span>
              </motion.div>
            ) : (
              <div 
                className="flex items-center gap-2 px-3 py-1 bg-[#f5f5f7] border border-black/5 text-[#86868b] text-[11px] font-semibold rounded-full"
                title="就绪：当您在左端上传完设备或交换机终端日志文件后，匹配内容将立即在右侧展现"
              >
                <div className="h-1.5 w-1.5 rounded-full bg-gray-300"></div>
                <Sparkles className="w-3 h-3 opacity-60" />
                <span>实时提取就绪（等待日志）</span>
              </div>
            )
          )}
        </div>
      </header>

      <main className="pt-14 grid grid-cols-1 lg:grid-cols-5 h-screen overflow-hidden">
        {/* Left Panel: Inputs */}
        <section className="border-r border-black/5 flex flex-col overflow-hidden bg-white lg:col-span-2">
          <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
            <div className="max-w-xl mx-auto space-y-10">
              {/* Log Upload Section - Moved to Top */}
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight">日志上传</h2>
                <p className="text-sm text-[#86868b] mt-1 mb-6">首先上传需要处理的日志文件</p>
                <div className="space-y-4">
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className={`h-40 border border-dashed rounded-2xl flex flex-col items-center justify-center p-6 cursor-pointer transition-all ${fileName ? 'bg-[#f5f5f7] border-[#0071e3]' : 'bg-white border-black/10 hover:border-[#0071e3]'}`}
                  >
                    <input 
                      type="file" 
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      className="hidden"
                      accept=".txt,.log,.csv"
                    />
                    <Upload className={`w-10 h-10 mb-3 ${fileName ? 'text-[#0071e3]' : 'text-[#86868b] opacity-40'}`} />
                    <p className="text-[12px] font-medium text-center">
                      {fileName ? '已选择文件' : '点击或拖拽上传日志文件'}
                    </p>
                    <p className="text-[10px] text-[#86868b] mt-1">支持 .txt, .log, .csv</p>
                  </div>

                  {fileName && (
                    <div className="bg-[#f5f5f7] rounded-xl p-3 flex justify-between items-center border border-black/5">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <FileText className="w-4 h-4 text-[#0071e3] flex-shrink-0" />
                        <span className="text-[11px] font-medium truncate">{fileName}</span>
                      </div>
                      <button 
                        onClick={(e) => { e.stopPropagation(); clearFile(); }}
                        className="p-1 text-[#86868b] hover:text-[#1d1d1f] transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {logContent && appMode !== 'fault' && (
                    <div className="rounded-xl border border-black/5 bg-white p-4 overflow-hidden">
                      <p className="text-[10px] font-semibold text-[#86868b] uppercase mb-2">内容预览</p>
                      <pre className="text-[10px] font-mono whitespace-pre-wrap leading-relaxed opacity-70 h-20 overflow-y-auto">
                        {logContent.slice(0, 500)}{logContent.length > 500 ? '...' : ''}
                      </pre>
                    </div>
                  )}
                </div>
              </div>

              {/* Config view switcher based on App Mode */}
              {appMode === 'all' ? (
                <>
                  {/* Smart Prompt Detection (only if file loaded) */}
                  {logContent && (
                    <div className="pt-10 border-t border-black/5 animate-fadeIn space-y-4">
                      <div className="flex justify-between items-baseline">
                        <h2 className="text-[15px] font-semibold tracking-tight">智能提示符识别</h2>
                        <span className="text-[10px] text-[#86868b] font-mono">Auto-Detection</span>
                      </div>
                      <p className="text-xs text-[#86868b] leading-relaxed">
                        系统已自动分析日志文件。请点击下方检测到的终端提示符模板，或在下方输入自定义值。
                      </p>

                      {detectedPrompts.length > 0 ? (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {detectedPrompts.map((dp, idx) => {
                            const isSelected = !customPromptEnabled && (selectedPrompt === dp.prompt || (!selectedPrompt && idx === 0));
                            return (
                              <button
                                key={idx}
                                onClick={() => {
                                  setCustomPromptEnabled(false);
                                  setSelectedPrompt(dp.prompt);
                                }}
                                className={`px-3 py-2 rounded-xl text-xs font-mono border transition-all flex items-center gap-2 cursor-pointer ${
                                  isSelected
                                    ? 'bg-[#0071e3]/5 border-[#0071e3] text-[#0071e3] font-semibold'
                                    : 'bg-[#f5f5f7] border-black/5 text-[#86868b] hover:border-black/15 hover:text-[#1d1d1f]'
                                }`}
                              >
                                <span className="truncate max-w-[150px]">{dp.prompt}</span>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${isSelected ? 'bg-[#0071e3]/15 text-[#0071e3]' : 'bg-black/5 text-[#86868b]'}`}>
                                  {dp.count}条指令
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="bg-[#f5f5f7] border border-black/5 rounded-2xl p-4 text-[11px] text-[#86868b] flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-[#86868b] shrink-0" />
                          <span>未匹配到常用前缀，将默认匹配普通命令行开头 [ &gt;, #, $ ]</span>
                        </div>
                      )}

                      {/* Custom Prompt Text Area */}
                      <div className="bg-[#f5f5f7] rounded-2xl p-4 border border-black/5 space-y-3 mt-4">
                        <label className="flex items-center gap-2 text-[11px] font-bold text-[#1d1d1f] uppercase tracking-wider cursor-pointer">
                          <input
                            type="checkbox"
                            checked={customPromptEnabled}
                            onChange={(e) => setCustomPromptEnabled(e.target.checked)}
                            className="accent-[#0071e3] h-3.5 w-3.5"
                          />
                          使用自定义前缀或正则
                        </label>
                        {customPromptEnabled && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="space-y-2 pt-1"
                          >
                            <input
                              type="text"
                              value={customPromptText}
                              onChange={(e) => setCustomPromptText(e.target.value)}
                              placeholder="例如: admin@switch# 或 /^[a-z]+>/"
                              className="w-full bg-white border border-black/10 rounded-xl p-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 focus:border-[#0071e3] transition-all"
                            />
                            <p className="text-[10px] text-[#86868b] leading-tight">
                              提示: 我们会将输入字符串转为匹配模型，用于精确判定行内命令的发起。
                            </p>
                          </motion.div>
                        )}
                      </div>
                    </div>
                  )}

                </>
              ) : appMode === 'targeted' ? (
                /* Command Configuration Section - Moved Below Upload */
                <div className="pt-10 border-t border-black/5">
                  <div className="flex justify-between items-end mb-6">
                    <div>
                      <h2 className="text-[15px] font-semibold tracking-tight">命令配置</h2>
                      <p className="text-sm text-[#86868b] mt-1">配置需要提取的目标命令及结束标识</p>
                    </div>
                    <button 
                      onClick={addCommandPair}
                      className="flex items-center gap-1 text-[12px] font-medium text-[#0071e3] hover:underline"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      添加命令
                    </button>
                  </div>

                  <div className="space-y-4">
                    <AnimatePresence initial={false}>
                      {commandPairs.map((pair, index) => (
                        <motion.div 
                          key={pair.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className="bg-[#f5f5f7] rounded-2xl p-6 relative group border border-black/5"
                        >
                          <div className="absolute -left-2 -top-2 bg-[#1d1d1f] text-white w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shadow-sm">
                            {index + 1}
                          </div>
                          
                          {commandPairs.length > 1 && (
                            <button 
                              onClick={() => removeCommandPair(pair.id)}
                              className="absolute right-4 top-4 p-1.5 text-[#86868b] hover:text-[#ff3b30] transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                              <label className="block text-[11px] font-semibold text-[#86868b] uppercase tracking-wider">目标命令关键词</label>
                              <input 
                                type="text"
                                value={pair.targetCommand}
                                onChange={(e) => updateCommandPair(pair.id, 'targetCommand', e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleProcess()}
                                placeholder="例如: show version"
                                className="w-full bg-white border border-black/10 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 focus:border-[#0071e3] transition-all"
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="block text-[11px] font-semibold text-[#86868b] uppercase tracking-wider">结束命令关键词</label>
                              <input 
                                type="text"
                                value={pair.promptPattern}
                                onChange={(e) => updateCommandPair(pair.id, 'promptPattern', e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleProcess()}
                                placeholder="例如: BCM.0>"
                                className="w-full bg-white border border-black/10 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 focus:border-[#0071e3] transition-all"
                              />
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              ) : (
                /* Fault Location Configuration Section */
                <div className="pt-10 border-t border-black/5 space-y-6 animate-fadeIn">
                  {/* Status Radar Banner (Compact and Simplified) */}
                  {logContent ? (
                    <motion.div 
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-blue-500/[0.04] border border-blue-500/10 px-4 py-2.5 rounded-xl flex items-center gap-2.5 text-xs text-[#1d1d1f]"
                    >
                      <div className="w-2 h-2 rounded-full bg-[#0071e3] animate-pulse" />
                      <span className="font-bold">分析雷达已激活</span>
                      <span className="text-[#86868b] font-normal">| 已载入日志，底层诊断数据全自动刷新。</span>
                    </motion.div>
                  ) : (
                    <div className="bg-orange-500/[0.04] border border-orange-500/10 px-4 py-2.5 rounded-xl flex items-center gap-2.5 text-xs text-[#1d1d1f]">
                      <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                      <span className="font-bold">分析器挂起中</span>
                      <span className="text-[#86868b] font-normal">| 待载入芯片、交换机或诊断终端日志。</span>
                    </div>
                  )}

                  <div>
                    <h2 className="text-[14px] md:text-[15px] font-semibold tracking-tight text-[#1d1d1f] flex items-center gap-1.5">
                      <span>⚙️</span> 芯片故障诊断探针配置
                    </h2>
                    <p className="text-xs text-[#86868b] mt-1 leading-relaxed">
                      基于设备运行时产生的 SerDes、ASIC 底层日志开展故障智能匹配与管脚定位。
                    </p>
                  </div>

                  <div className="space-y-4">
                    {/* Item 1 */}
                    <div className="bg-[#f5f5f7] rounded-2xl p-5 border border-black/5 space-y-3">
                      <h3 className="text-xs font-bold text-[#1d1d1f] uppercase tracking-wider flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                        诊断检测项 1：产品型号与 SDK 固件版本提取
                      </h3>
                      <p className="text-[11px] text-[#86868b] leading-relaxed">
                        深度扫描日志全文，通过 PRODUCT NAME 字段、ONIE 环境变量、主板 DMI、设备树或 machine.conf 清单，按规则推断及智能清洗输出标准化设备产品型号，并同步提取 Broadcom SDK 固件版本。
                      </p>
                      <div className="bg-white border border-black/[0.04] p-3 rounded-xl text-[10px] text-[#555] font-mono leading-relaxed space-y-1">
                        <div><strong className="text-[#0071e3]">型号来源：</strong>PRODUCT NAME、onie_machine、onie_platform等备选变量</div>
                        <div><strong className="text-[#0071e3]">SDK 匹配：</strong>包含 <code className="bg-black/5 px-1 py-0.5 rounded text-red-500 font-mono text-[9px]">Release: sdk-</code> 标识整机底层固件套件版本</div>
                        <div><strong className="text-[#0071e3]">清洗特征：</strong>自动去除 x86_64- 架构前缀与 -r0 修订版后缀 (如 tencent_tcs8400)</div>
                      </div>
                    </div>

                    {/* Item 2 */}
                    <div className="bg-[#f5f5f7] rounded-2xl p-5 border border-black/5 space-y-3">
                      <h3 className="text-xs font-bold text-[#1d1d1f] uppercase tracking-wider flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-red-500"></span>
                        诊断检测项 2：微控制器 uc_sts 运行异常位
                      </h3>
                      <p className="text-[11px] text-[#86868b] leading-relaxed">
                        精准锁定带有 <code className="bg-[#f5f5f7] px-1 py-0.5 rounded text-red-500 font-mono text-[9px]">uc_sts BIT</code> / <code className="bg-[#f5f5f7] px-1 py-0.5 rounded text-red-500 font-mono text-[9px]">uc_sts_ext BIT</code> 的硬件报故障日志。
                      </p>
                      <div className="bg-white border border-black/[0.04] p-3 rounded-xl text-[10px] text-[#555] font-mono leading-relaxed space-y-1.5">
                        <div className="flex justify-between">
                           <span>📊 <strong>提取上下文：</strong>向上追溯至最近一次 <code>dsh -c 'phy diag</code> 字段，向下追溯 6 行</span>
                           <span className="text-[#0071e3] font-bold">自适应上下文</span>
                        </div>
                        <div>🛡️ <strong>独立提取去重：</strong>按捕获点独立输出，带首尾溢出及文件触顶/底边界气泡。</div>
                      </div>
                    </div>

                    {/* Item 3 */}
                    <div className="bg-[#f5f5f7] rounded-2xl p-5 border border-black/5 space-y-3">
                      <h3 className="text-xs font-bold text-[#1d1d1f] uppercase tracking-wider flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                        诊断检测项 3：Link Training (LT) 分轨链路电平探测
                      </h3>
                      <p className="text-[11px] text-[#86868b] leading-relaxed">
                        通篇检索物理接口的 Link UP / DOWN 变迁历史。根据流式时序中的 <code className="bg-[#f5f5f7] px-1 py-0.5 rounded text-amber-600 font-mono text-[9px]">link_training</code> 的特征标志（0-OFF / 1-ON），分类聚合与溯源物理电平。
                      </p>
                      <div className="bg-white border border-black/[0.04] p-3 rounded-xl text-[10px] text-[#555] font-mono leading-relaxed space-y-1.5">
                        <div>🔗 <strong>LT 分类隔离：</strong>区分不同 LT 配置态下的最终链路电平，重构状态全貌.</div>
                        <div>📊 <strong>异构语法兼容：</strong>自动识别诊断表格各对齐列，且深度兼融单行模糊不规则语句.</div>
                      </div>
                    </div>
                  </div>

                  {/* 故障芯片管脚定位 Widget */}
                  <div className="pt-8 border-t border-black/5 space-y-4">
                    <div>
                      <h2 className="text-[14px] md:text-[15px] font-semibold tracking-tight text-[#1d1d1f] flex items-center gap-1.5">
                        <span>🔍</span> 故障芯片管脚定位
                      </h2>
                      <p className="text-xs text-[#86868b] mt-1 leading-relaxed">
                        根据选择的产品型号（当前支持 AS14）、输入的 CD 号、Lane 号以及传输流向，从对应映射关系中检索出对应芯片的 Pin 名称和管脚编号。
                      </p>
                    </div>

                    <div className="bg-[#f5f5f7] rounded-2xl p-5 border border-black/5 space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        {/* 产品型号 (下拉单选) - appearance-none adds appearance:none to disable standard select arrow */}
                        <div className="space-y-1.5 col-span-2 sm:col-span-1">
                          <label className="block text-[10px] font-bold text-[#86868b] uppercase tracking-wider">产品型号 (下拉单选)</label>
                          <div className="relative">
                            <select
                              value={pinModel}
                              onChange={(e) => setPinModel(e.target.value as 'AS14')}
                              className="w-full bg-white border border-black/10 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 focus:border-[#0071e3] transition-all pr-8 font-medium cursor-pointer appearance-none"
                            >
                              <option value="AS14">AS14 (当前支持)</option>
                            </select>
                            <ChevronDown className="w-4 h-4 text-[#86868b] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-60" />
                          </div>
                        </div>

                        {/* 传输流码 (RX/TX) */}
                        <div className="space-y-1.5 col-span-2 sm:col-span-1">
                          <label className="block text-[10px] font-bold text-[#86868b] uppercase tracking-wider">传输类型 (单选)</label>
                          <div className="flex bg-white border border-black/10 p-0.5 rounded-xl">
                            <button
                              type="button"
                              onClick={() => setPinType('RX')}
                              className={`flex-1 py-1 text-center text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                                pinType === 'RX' 
                                  ? 'bg-[#0071e3] text-white shadow-sm' 
                                  : 'text-[#86868b] hover:text-[#1d1d1f]'
                              }`}
                            >
                              接收 RX
                            </button>
                            <button
                              type="button"
                              onClick={() => setPinType('TX')}
                              className={`flex-1 py-1 text-center text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                                pinType === 'TX' 
                                  ? 'bg-[#0071e3] text-white shadow-sm' 
                                  : 'text-[#86868b] hover:text-[#1d1d1f]'
                              }`}
                            >
                              发送 TX
                            </button>
                          </div>
                        </div>

                        {/* CD 号 (文本输入) */}
                        <div className="space-y-1.5 col-span-2 sm:col-span-1">
                          <label className="block text-[10px] font-bold text-[#86868b] uppercase tracking-wider">CD 号 (文本输入)</label>
                          <div className="relative">
                            <input
                              type="text"
                              value={pinCd}
                              onChange={(e) => setPinCd(e.target.value)}
                              placeholder="例如: cd0, cd1... cd31"
                              className="w-full bg-white border border-black/10 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 focus:border-[#0071e3] transition-all font-mono"
                              list="cd-suggestions"
                            />
                            <datalist id="cd-suggestions">
                              {Array.from({ length: 32 }, (_, i) => `cd${i}`).map(v => (
                                <option key={v} value={v} />
                              ))}
                            </datalist>
                            {pinCd && (
                              <button
                                onClick={() => setPinCd('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-black"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Lane 号 (文本输入) - Suggestions size changed to length: 8 for lane0 to lane7 (eliminates lane8) */}
                        <div className="space-y-1.5 col-span-2 sm:col-span-1">
                          <label className="block text-[10px] font-bold text-[#86868b] uppercase tracking-wider">Lane 号 (文本输入)</label>
                          <div className="relative">
                            <input
                              type="text"
                              value={pinLane}
                              onChange={(e) => setPinLane(e.target.value)}
                              placeholder="例如: lane0, lane1... lane7"
                              className="w-full bg-white border border-black/10 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 focus:border-[#0071e3] transition-all font-mono"
                              list="lane-suggestions"
                            />
                            <datalist id="lane-suggestions">
                              {Array.from({ length: 8 }, (_, i) => `lane${i}`).map(v => (
                                <option key={v} value={v} />
                              ))}
                            </datalist>
                            {pinLane && (
                              <button
                                onClick={() => setPinLane('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-black"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* 实时定位检索结果 */}
                      <div className="bg-white border border-black/5 rounded-xl p-4 space-y-2.5 shadow-sm">
                        <div className="flex justify-between items-center border-b border-black/[0.04] pb-2">
                          <span className="text-[10px] font-bold text-[#86868b] uppercase tracking-wider">🔍 芯片 Pin / 管脚定位检索结果</span>
                          {pinQueryResults.length > 0 && (
                            <button
                              onClick={() => {
                                const textToCopy = pinQueryResults.map(p => `${p.chipPinName} (${p.chipPinCode})`).join('\n');
                                navigator.clipboard.writeText(textToCopy);
                                setCopiedPinResult(true);
                                setTimeout(() => setCopiedPinResult(false), 2000);
                              }}
                              className="text-[10px] font-semibold text-[#0071e3] hover:underline flex items-center gap-1 cursor-pointer"
                            >
                              {copiedPinResult ? <Check className="w-2.5 h-2.5 text-green-500" /> : <Clipboard className="w-2.5 h-2.5" />}
                              {copiedPinResult ? '已复制' : '复制结果'}
                            </button>
                          )}
                        </div>

                        {pinQueryResults.length > 0 ? (
                          <div className="space-y-2 pt-1 font-mono">
                            {pinQueryResults.map((p, idx) => (
                              <div key={idx} className="flex justify-between items-center text-xs bg-slate-50 border border-black/[0.02] rounded-lg px-3 py-2">
                                <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                  {p.chipPinName}
                                </span>
                                <span className="text-[#0071e3] font-bold bg-[#0071e3]/5 px-2 py-0.5 rounded border border-[#0071e3]/10">
                                  {p.chipPinCode}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[11px] text-[#ff3b30] bg-[#ff3b30]/[0.02] border border-[#ff3b30]/10 p-3 rounded-lg flex items-center gap-2">
                            <AlertCircle className="w-3.5 h-3.5 select-none text-[#ff3b30] shrink-0" />
                            <span>未找到对应引脚，请检查 CD 号、Lane 号或信号类型是否正确。</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Right Panel: Results */}
        <section className="flex flex-col overflow-hidden bg-[#f5f5f7] lg:col-span-3">
          {appMode === 'all' ? (
            /* User Commands Extractor Mode Right Panel */
            <>
              <div className="p-6 flex flex-col md:flex-row gap-4 justify-between items-start md:items-center border-b border-black/[0.03]">
                <div>
                  <h2 className="text-[15px] font-semibold tracking-tight">提取结果 (全命令行)</h2>
                  {extractedCommands.length > 0 ? (
                    <p className="text-sm text-[#86868b] mt-1">
                      系统共提取到 {extractedCommands.length} 条已执行指令
                    </p>
                  ) : (
                    <p className="text-sm text-[#86868b] mt-1">上传日志后在右侧显示已执行指令</p>
                  )}
                </div>
                
                {extractedCommands.length > 0 && (
                  <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                    {/* Search result filter */}
                    <div className="bg-white border border-black/10 rounded-xl px-3 py-1.5 flex items-center gap-2 shadow-sm w-full md:w-44 focus-within:md:w-56 transition-all duration-300">
                      <Search className="w-3.5 h-3.5 text-[#86868b] shrink-0" />
                      <input
                        type="text"
                        placeholder="检索指令过滤..."
                        value={allCommandsQuery}
                        onChange={(e) => setAllCommandsQuery(e.target.value)}
                        className="bg-transparent text-[11px] border-none outline-none focus:outline-none focus:ring-0 p-0 m-0 w-full font-medium"
                      />
                    </div>
                    
                    <button 
                      onClick={copyAllCommandsToClipboard}
                      className="px-4 py-1.5 bg-white border border-black/10 text-[11px] font-medium rounded-full hover:bg-white/80 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer shrink-0"
                    >
                      {copiedAll ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Clipboard className="w-3.5 h-3.5" />}
                      复制指令集
                    </button>
                    <button 
                      onClick={downloadAllCommands}
                      className="px-4 py-1.5 bg-[#1d1d1f] text-white text-[11px] font-medium rounded-full hover:bg-black transition-all flex items-center gap-1.5 shadow-sm cursor-pointer shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                      导出 .log
                    </button>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-auto p-6 pt-0 custom-scrollbar">
                <AnimatePresence mode="wait">
                  {!logContent ? (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="h-full flex flex-col items-center justify-center text-[#86868b] text-center"
                    >
                      <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center shadow-sm mb-6 border border-black/5">
                        <Terminal className="w-10 h-10 opacity-20" />
                      </div>
                      <p className="text-sm font-medium">请在左侧上传设备或交换机终端日志文件</p>
                      <p className="text-xs text-[#86868b] mt-1 max-w-[280px]">自动识别会话中所有敲击执行的 shell 命令并有序排列</p>
                    </motion.div>
                  ) : extractedCommands.length === 0 ? (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="h-full flex flex-col items-center justify-center text-center p-6"
                    >
                      <AlertCircle className="w-12 h-12 mb-4 text-[#86868b] opacity-40" />
                      <p className="font-semibold text-sm">未能在此提示符下检索到命令行</p>
                      <p className="text-xs text-[#86868b] mt-2 max-w-[320px] leading-relaxed">
                        可能原因：当前选定的提示符匹配前缀与日志中的终端符号有出入。请检查左侧“智能提示符识别”面板，并尝试勾选“自定义前缀”，手动定义或选择更贴合的提示标识。
                      </p>
                    </motion.div>
                  ) : (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="py-6 space-y-6 w-full"
                    >
                      {/* Analytics Widgets */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white rounded-2xl p-4 border border-black/5 shadow-sm">
                          <span className="text-[10px] text-[#86868b] font-bold uppercase tracking-wider block">有效提指令总数</span>
                          <span className="text-[20px] font-bold text-[#1d1d1f] block mt-1">{extractedCommands.length} 行</span>
                        </div>
                        <div className="bg-white rounded-2xl p-4 border border-black/5 shadow-sm">
                          <span className="text-[10px] text-[#86868b] font-bold uppercase tracking-wider block">当前过滤展现</span>
                          <span className="text-[20px] font-bold text-[#0071e3] block mt-1">{filteredAllCommands.length} 行</span>
                        </div>
                      </div>

                      {/* Filter list container */}
                      {filteredAllCommands.length === 0 ? (
                        <div className="bg-white rounded-2xl p-8 text-center text-[#86868b] text-xs border border-black/5">
                          无匹配搜索关键字的指令...
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          {filteredAllCommands.map((item, idx) => (
                            <div 
                              key={idx} 
                              className="bg-white rounded-2xl p-4 border border-black/5 shadow-sm flex items-start justify-between gap-4 hover:border-black/15 hover:shadow-md transition-all group duration-200"
                            >
                              <div className="flex items-start gap-3 flex-1 overflow-hidden">
                                <span className="bg-[#f5f5f7] text-[#86868b] text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 font-mono mt-0.5">
                                  L{item.lineNum}
                                </span>
                                <div className="flex-1 overflow-x-auto">
                                  <pre className="font-mono text-[12px] text-[#1D1D23] leading-relaxed break-all whitespace-pre-wrap select-all">{item.command}</pre>
                                </div>
                              </div>
                              
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(item.command);
                                }}
                                className="p-1.5 text-[#86868b] hover:text-[#0071e3] hover:bg-[#0071e3]/5 rounded-xl transition-all opacity-0 group-hover:opacity-100 shrink-0 cursor-pointer"
                                title="复制单条指令"
                              >
                                <Clipboard className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </>
          ) : appMode === 'targeted' ? (
            /* Targeted Output Collector Mode Right Panel */
            <>
              <div className="p-6 flex justify-between items-center">
                <div>
                  <h2 className="text-[15px] font-semibold tracking-tight">提取结果</h2>
                  {results && results.length > 0 && (
                    <p className="text-sm text-[#86868b] mt-1">共找到 {results.length} 个匹配项</p>
                  )}
                </div>
                {results && results.length > 0 && (
                  <div className="flex gap-3">
                    <button 
                      onClick={copyToClipboard}
                      className="px-4 py-1.5 bg-white border border-black/10 text-[11px] font-medium rounded-full hover:bg-white/80 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Clipboard className="w-3.5 h-3.5" />}
                      复制全部
                    </button>
                    <button 
                      onClick={downloadAllSeparately}
                      className="px-4 py-1.5 bg-[#1d1d1f] text-white text-[11px] font-medium rounded-full hover:bg-black transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      批量下载
                    </button>
                  </div>
                )}
              </div>

              {results && results.length > 0 && (
                <div className="px-6 pb-4 border-b border-black/5 animate-fadeIn">
                  <div className="bg-[#f5f5f7] border border-black/5 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-2 text-[11px] font-semibold text-[#86868b] uppercase tracking-wider shrink-0">
                      <FileText className="w-3.5 h-3.5" />
                      <span>自定义导出文件名:</span>
                    </div>
                    <div className="flex-grow relative">
                      <input 
                        type="text"
                        id="custom-export-filename-input"
                        onChange={(e) => setCustomExportName(e.target.value)}
                        placeholder="例如: diagnostic_report (不包含 .log 后缀，留白使用默认格式)"
                        className="w-full bg-white border border-black/10 rounded-lg py-1 px-3 pr-8 text-xs focus:outline-none focus:ring-1 focus:ring-[#0071e3] focus:border-[#0071e3] transition-all font-mono"
                      />
                      {customExportName && (
                        <button
                          onClick={() => setCustomExportName('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-[#86868b] hover:text-[#1d1d1f] transition-colors rounded-full hover:bg-black/5 cursor-pointer"
                          title="清除文件名"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-auto p-6 pt-0 custom-scrollbar">
                <AnimatePresence mode="wait">
                  {!results ? (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="h-full flex flex-col items-center justify-center text-[#86868b] text-center"
                    >
                      <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center shadow-sm mb-6 border border-black/5">
                        <Terminal className="w-10 h-10 opacity-20" />
                      </div>
                      <p className="text-sm font-medium">配置命令并上传日志以开始说明</p>
                    </motion.div>
                  ) : results.length === 0 ? (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="h-full flex flex-col items-center justify-center text-[#ff3b30] text-center"
                    >
                      <AlertCircle className="w-12 h-12 mb-4 opacity-50" />
                      <p className="font-semibold">未在日志中找到任何匹配命令</p>
                    </motion.div>
                  ) : (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="space-y-6 w-full"
                    >
                      {(Object.entries(groupedResults || {}) as [string, ExtractionResult[]][]).map(([pairId, pairResults]) => {
                        const pair = commandPairs.find(p => p.id === pairId);
                        if (!pair) return null;
                        const isExpanded = expandedGroups.has(pairId);
                        
                        return (
                          <div key={pairId} className="bg-white rounded-2xl overflow-hidden shadow-sm border border-black/5">
                            <div 
                              onClick={() => toggleGroup(pairId)}
                              className="flex justify-between items-center p-5 cursor-pointer hover:bg-black/[0.02] transition-colors"
                            >
                              <div className="flex items-center gap-4">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${isExpanded ? 'bg-[#0071e3] text-white' : 'bg-[#f5f5f7] text-[#86868b]'}`}>
                                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                </div>
                                <div>
                                  <span className="text-[13px] font-semibold block animate-fadeIn">
                                    {pair.targetCommand || `[从文件开头 ➔ 直到结束标识: ${pair.promptPattern}]`}
                                  </span>
                                  <span className="text-[10px] text-[#86868b] font-medium uppercase tracking-wider">
                                    {pairResults.length} 个匹配项
                                  </span>
                                </div>
                              </div>
                              <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                                <button 
                                  onClick={() => copyPairToClipboard(pairId)}
                                  className="p-2 text-[#86868b] hover:text-[#0071e3] hover:bg-[#0071e3]/5 rounded-full transition-all"
                                  title="复制该组结果"
                                >
                                  <Clipboard className="w-4 h-4" />
                                </button>
                                <button 
                                  onClick={() => downloadPairResult(pairId)}
                                  className="p-2 text-[#86868b] hover:text-[#0071e3] hover:bg-[#0071e3]/5 rounded-full transition-all"
                                  title="下载该组结果"
                                >
                                  <Download className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                            
                            <AnimatePresence>
                              {isExpanded && (
                                <motion.div 
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.3, ease: 'easeInOut' }}
                                >
                                  <div className="p-5 pt-0 space-y-8 border-t border-black/5 mt-2">
                                    {pairResults.map((res, idx) => {
                                      const resultKey = `${res.pairId}-${res.lineNum}`;
                                      const isResultExpanded = expandedResults.has(resultKey);
                                      
                                      return (
                                        <div key={idx} className="space-y-3 pt-5 border-t border-[#1d1d1f]/[0.03] first:border-t-0 first:pt-4">
                                          <div 
                                            className="flex items-center justify-between cursor-pointer group/item gap-4"
                                            onClick={() => toggleResult(res.pairId, res.lineNum)}
                                          >
                                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                              <span className="bg-[#f5f5f7] text-[#86868b] px-2.5 py-1 rounded-md text-[10px] font-bold font-mono shrink-0">
                                                L{res.lineNum}
                                              </span>
                                              <span className="font-mono text-[11px] md:text-[12px] font-semibold text-[#1d1d1f] truncate group-hover/item:text-[#0071e3] transition-colors">
                                                {res.command}
                                              </span>
                                            </div>
                                            <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                                              <button
                                                onClick={() => copySingleResultToClipboard(res)}
                                                className="p-1.5 text-[#86868b] hover:text-[#0071e3] hover:bg-[#0071e3]/5 rounded-lg transition-all cursor-pointer"
                                                title="复制此目标指令提取片段"
                                              >
                                                {copiedItemKey === `${res.pairId}-${res.lineNum}` ? (
                                                  <Check className="w-3.5 h-3.5 text-green-500 animate-scaleIn" />
                                                ) : (
                                                  <Clipboard className="w-3.5 h-3.5" />
                                                )}
                                              </button>
                                              <button
                                                onClick={() => downloadSingleResult(res)}
                                                className="p-1.5 text-[#86868b] hover:text-[#0071e3] hover:bg-[#0071e3]/5 rounded-lg transition-all cursor-pointer"
                                                title="下载此目标指令提取片段"
                                              >
                                                <Download className="w-3.5 h-3.5" />
                                              </button>
                                              <div 
                                                className="text-[#86868b] pl-1 py-1 cursor-pointer hover:text-[#0071e3] transition-colors"
                                                onClick={() => toggleResult(res.pairId, res.lineNum)}
                                              >
                                                {isResultExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                              </div>
                                            </div>
                                          </div>
                                          
                                          <AnimatePresence>
                                            {isResultExpanded && (
                                              <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                transition={{ duration: 0.2 }}
                                                className="overflow-hidden"
                                              >
                                                <div className="bg-[#f5f5f7] rounded-xl p-4 font-mono text-[11px] text-[#444] whitespace-pre-wrap leading-relaxed border border-black/[0.03]">
                                                  {res.output.join('\n')}
                                                </div>
                                              </motion.div>
                                            )}
                                          </AnimatePresence>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </>
          ) : (
            /* Fault Location Mode Right Panel */
            <>
              <div className="p-6 flex flex-col md:flex-row gap-4 justify-between items-start md:items-center border-b border-black/[0.03]">
                <div>
                  <h2 className="text-[15px] font-semibold tracking-tight">异常故障诊断报告</h2>
                  {!logContent ? (
                    <p className="text-sm text-[#86868b] mt-1">等待左侧解析上载的文件以输出芯片报告</p>
                  ) : (
                    <p className="text-sm text-[#86868b] mt-1">
                      系统已全自动完成深度扫描汇整
                    </p>
                  )}
                </div>
                
                {logContent && (
                  <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                    <button 
                      onClick={copyFaultReportToClipboard}
                      className="px-4 py-1.5 bg-white border border-black/10 text-[11px] font-medium rounded-full hover:bg-white/80 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer shrink-0"
                    >
                      {copiedFaultReport ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Clipboard className="w-3.5 h-3.5" />}
                      复制全量报告
                    </button>
                    <button 
                      onClick={downloadFaultReport}
                      className="px-4 py-1.5 bg-[#1d1d1f] text-white text-[11px] font-medium rounded-full hover:bg-[#1d1d1f]/90 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                      导出诊断报告
                    </button>
                  </div>
                )}
              </div>

              {/* Custom Export Filename input for fault section */}
              {logContent && (
                <div className="px-6 pb-4 border-b border-black/5 animate-fadeIn">
                  <div className="bg-[#f5f5f7] border border-black/5 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-2 text-[11px] font-semibold text-[#86868b] uppercase tracking-wider shrink-0">
                      <FileText className="w-3.5 h-3.5" />
                      <span>报告自定义输出文件名:</span>
                    </div>
                    <div className="flex-grow relative">
                      <input 
                        type="text"
                        value={customExportName}
                        onChange={(e) => setCustomExportName(e.target.value)}
                        placeholder="例如: chip_fault_diagnostic (留白使用原文件名+'_fault_location_report')"
                        className="w-full bg-white border border-black/10 rounded-lg py-1 px-3 pr-8 text-xs focus:outline-none focus:ring-1 focus:ring-[#0071e3] focus:border-[#0071e3] transition-all font-mono"
                      />
                      {customExportName && (
                        <button
                          onClick={() => setCustomExportName('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-[#86868b] hover:text-[#1d1d1f] transition-colors rounded-full hover:bg-black/5 cursor-pointer"
                        >
                          <X className="w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-auto p-6 pt-0 custom-scrollbar">
                {/* 2. 异常日志诊断报告分区 (Conditional) */}
                <div className="pt-4 border-t border-black/5">
                  <AnimatePresence mode="wait">
                    {!logContent ? (
                      <motion.div 
                        key="empty-fault"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        className="bg-[#1d1d1f]/[0.02] border border-[#1d1d1f]/5 rounded-2xl p-6 flex flex-col items-center text-center space-y-3"
                      >
                        <div className="w-9 h-9 rounded-full bg-[#1d1d1f]/5 flex items-center justify-center text-[#1d1d1f]/40">
                          <Cpu className="w-4 h-4 animate-pulse" />
                        </div>
                        <div>
                          <h4 className="text-[12px] font-bold text-[#1d1d1f] uppercase tracking-wider">异常故障日志深度诊断报告 (待载入)</h4>
                          <p className="text-[11px] text-[#86868b] max-w-sm mx-auto mt-1 leading-relaxed">
                            当前尚未上传交换机日志。如有运行期 <code>uc_sts</code> 状态寄存器故障打印，请于左侧上载连接文件，系统将全自动解析对齐各端口链路状态、固件版本并汇整生成深度诊断报告。
                          </p>
                        </div>
                      </motion.div>
                    ) : (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="space-y-6 w-full"
                    >
                      {/* Metric Widgets */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white rounded-2xl p-4 border border-black/5 shadow-sm flex flex-col justify-center">
                          <span className="text-[10px] text-[#86868b] font-bold uppercase tracking-wider block">产品型号</span>
                          <span className={`text-[15px] md:text-[16px] font-bold block mt-1 truncate ${faultAnalysis.productModel !== 'UNKNOWN' ? 'text-[#24a148]' : 'text-[#ff3b30]'}`} title={faultAnalysis.productModel}>
                            {faultAnalysis.productModel}
                          </span>
                        </div>
                        <div className="bg-white rounded-2xl p-4 border border-black/5 shadow-sm">
                          <span className="text-[10px] text-[#86868b] font-bold uppercase tracking-wider block">uc_sts 错误位发生数</span>
                          <span className={`text-[18px] font-bold block mt-1 ${faultAnalysis.ucStsMatches.length > 0 ? 'text-[#ff3b30]' : 'text-[#24a148]'}`}>
                            {faultAnalysis.ucStsMatches.length} 处
                          </span>
                        </div>
                      </div>

                      {/* Section 1: Broadcom SDK Version Status */}
                      <div className="bg-white rounded-2xl p-5 border border-black/5 shadow-sm space-y-3">
                        <h3 className="text-xs font-bold text-[#1d1d1f] uppercase tracking-wider flex items-center gap-1.5">
                          <Cpu className="w-4 h-4 text-[#0071e3]" />
                          一、Broadcom SDK 固件识别结果
                        </h3>
                        {faultAnalysis.sdkVersion ? (
                          <div className="bg-[#e3f9e5]/30 border border-[#24a148]/10 rounded-xl p-4 text-xs space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="bg-[#24a148] text-white text-[9px] font-bold px-1.5 py-0.5 rounded">SUCCESS</span>
                              <span className="font-semibold text-[#1d1d1f]">根据日志成功检测并解析到底层固件版本</span>
                            </div>
                            <div className="font-mono text-[14px] text-blue-600 font-bold bg-blue-50/50 px-3 py-1.5 rounded-lg border border-blue-500/10 inline-block">
                              SDK 版本：SDK-{faultAnalysis.sdkVersion}
                            </div>
                            {faultAnalysis.sdkVersionLine && (
                              <p className="text-[10px] text-[#86868b] leading-relaxed">
                                固件特征来源：<b>Release: sdk-{faultAnalysis.sdkVersion}</b> (调试日志第 L{faultAnalysis.sdkVersionLine} 行)。
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="bg-orange-500/[0.03] border border-orange-500/10 rounded-xl p-4 text-xs space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span className="bg-orange-400 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">NOT FOUND</span>
                              <span className="font-semibold text-[#1d1d1f]">未在日志中搜检到明确的 SDK 版本匹配行</span>
                            </div>
                            <div className="font-mono text-[14px] text-orange-600 font-bold bg-orange-50/[0.05] px-3 py-1.5 rounded-lg border border-orange-500/10 inline-block">
                              SDK 版本：未提取到 SDK 版本
                            </div>
                            <p className="text-[11px] text-[#86868b] leading-relaxed">
                              提示：日志全文未搜检到含有 <code className="bg-black/5 px-1 py-0.5 rounded font-mono text-[9px]">Release: sdk-</code> 的行。若已知其运行环境，可检查日志前段是否被提早截断。
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Section 2: uc_sts matches list */}
                      <div className="space-y-4">
                        <div className="flex justify-between items-center px-1">
                          <h3 className="text-xs font-bold text-[#1d1d1f] uppercase tracking-wider flex items-center gap-1.5">
                            <AlertCircle className="w-4 h-4 text-[#ff3b30]" />
                            二、UC_STS BIT/UC_STS_EXT BIT错误定位
                          </h3>
                          {faultAnalysis.ucStsMatches.length > 0 && (
                            <div className="flex gap-2">
                              <button
                                onClick={() => toggleAllFaultMatches(true)}
                                className="text-[10px] font-bold text-[#0071e3] transition-colors hover:underline cursor-pointer"
                              >
                                展开全部
                              </button>
                              <span className="text-[#86868b] text-[10px]">|</span>
                              <button
                                onClick={() => toggleAllFaultMatches(false)}
                                className="text-[10px] font-bold text-[#86868b] transition-colors hover:underline hover:text-[#1d1d1f] cursor-pointer"
                              >
                                收起全部
                              </button>
                            </div>
                          )}
                        </div>

                        {(() => {
                          const ltOffMatches = faultAnalysis.ucStsMatches.filter(m => m.ltState === 'OFF');
                          const ltOnMatches = faultAnalysis.ucStsMatches.filter(m => m.ltState === 'ON');
                          const ltUnknownMatches = faultAnalysis.ucStsMatches.filter(m => m.ltState === 'UNKNOWN');

                          if (faultAnalysis.ucStsMatches.length === 0) {
                            return (
                              <div className="bg-[#e3f9e5]/30 border border-[#24a148]/10 rounded-2xl p-8 text-center text-xs space-y-2">
                                <span className="text-[24px] block">🛡️</span>
                                <h4 className="font-bold text-[#24a148]">设备全绿：未搜检到任何 micro controller 错误告警位</h4>
                                <p className="text-[10px] text-[#86868b] max-w-[340px] mx-auto leading-relaxed">
                                  日志已通篇扫描。未含有 uc_sts BIT 、 uc_sts_ext BIT 的匹配行，微控制器状态指标异常无检出，SerDes 链路稳定性通过检测。
                                </p>
                              </div>
                            );
                          }

                          const renderFaultItem = (match: FaultMatch, idx: number, badgeColor: string, badgeBg: string, typeLabel: string) => {
                            const isMatchExpanded = expandedFaultMatches.has(match.lineNum);
                            return (
                              <div key={`${match.lineNum}-${idx}`} className="bg-white rounded-xl overflow-hidden border border-black/5 shadow-sm">
                                {/* Item Header */}
                                <div 
                                  onClick={() => {
                                    const newSet = new Set(expandedFaultMatches);
                                    if (newSet.has(match.lineNum)) {
                                      newSet.delete(match.lineNum);
                                    } else {
                                      newSet.add(match.lineNum);
                                    }
                                    setExpandedFaultMatches(newSet);
                                  }}
                                  className="flex justify-between items-center p-3.5 cursor-pointer hover:bg-black/[0.01] transition-colors gap-4"
                                >
                                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                    <span style={{ color: badgeColor, backgroundColor: badgeBg }} className="px-1.5 py-0.5 rounded text-[9px] font-bold font-mono shrink-0">
                                      {typeLabel} #{idx + 1}
                                    </span>
                                    <span className="bg-[#f5f5f7] text-[#86868b] px-1.5 py-0.5 rounded text-[9px] font-bold font-mono shrink-0">
                                      L{match.lineNum}
                                    </span>
                                    <span className="font-mono text-[11px] font-semibold text-[#1d1d1f] truncate">
                                      {match.matchText}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                                    <button
                                      onClick={() => copySingleFaultMatchToClipboard(match)}
                                      className="p-1.5 text-[#86868b] hover:text-[#0071e3] hover:bg-[#0071e3]/5 rounded-lg transition-all cursor-pointer"
                                      title="复制这段诊断上下文内容"
                                    >
                                      {copiedSingleMatch === String(match.lineNum) ? (
                                        <Check className="w-3.5 h-3.5 text-green-500 animate-scaleIn" />
                                      ) : (
                                        <Clipboard className="w-3.5 h-3.5" />
                                      )}
                                    </button>
                                    <button
                                      onClick={() => downloadSingleFaultMatch(match)}
                                      className="p-1.5 text-[#86868b] hover:text-[#0071e3] hover:bg-[#0071e3]/5 rounded-lg transition-all cursor-pointer"
                                      title="导出这段诊断上下文文件"
                                    >
                                      <Download className="w-3.5 h-3.5" />
                                    </button>
                                    <div 
                                      className="text-[#86868b] pl-1 py-1 cursor-pointer hover:text-[#0071e3] transition-colors"
                                      onClick={() => {
                                        const newSet = new Set(expandedFaultMatches);
                                        if (newSet.has(match.lineNum)) {
                                          newSet.delete(match.lineNum);
                                        } else {
                                          newSet.add(match.lineNum);
                                        }
                                        setExpandedFaultMatches(newSet);
                                      }}
                                    >
                                      {isMatchExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                    </div>
                                  </div>
                                </div>

                                {/* Expanded context view */}
                                <AnimatePresence>
                                  {isMatchExpanded && (
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: 'auto', opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      transition={{ duration: 0.15 }}
                                      className="overflow-hidden border-t border-black/[0.03] bg-[#f8f9fa]"
                                    >
                                      <div className="p-4 space-y-1">
                                        {/* Context Before */}
                                        {match.contextBefore.length < 6 && !match.foundPhyDiag && (
                                          <div className="text-[10px] text-orange-500 font-semibold bg-orange-500/5 border border-orange-500/10 rounded px-2.5 py-1 mb-2">
                                            ⚠ [边界提示] 已经到达日志开头，前置上下文实际只有 {match.contextBefore.length} 行，且未找到相关的 dsh -c 'phy diag 命令
                                          </div>
                                        )}
                                        
                                        {match.contextBefore.map((line, bIdx) => {
                                          const beforeLineNum = match.lineNum - match.contextBefore.length + bIdx;
                                          return (
                                            <div key={bIdx} className="flex font-mono text-[11px] leading-relaxed text-[#666]">
                                              <span className="w-10 opacity-40 select-none text-right pr-3 shrink-0">{beforeLineNum}</span>
                                              <span className="break-all whitespace-pre-wrap">{line}</span>
                                            </div>
                                          );
                                        })}

                                        {/* Target Main Line */}
                                        <div className="flex font-mono text-[11px] leading-relaxed text-[#d31145] bg-[#ff3b30]/5 border-l-2 border-[#ff3b30] font-bold py-1.5">
                                          <span className="w-10 opacity-70 select-none text-right pr-3 shrink-0">{match.lineNum}</span>
                                          <span className="break-all whitespace-pre-wrap">{match.matchText}</span>
                                        </div>

                                        {/* Context After */}
                                        {match.contextAfter.map((line, aIdx) => {
                                          const afterLineNum = match.lineNum + 1 + aIdx;
                                          return (
                                            <div key={aIdx} className="flex font-mono text-[11px] leading-relaxed text-[#666]">
                                              <span className="w-10 opacity-40 select-none text-right pr-3 shrink-0">{afterLineNum}</span>
                                              <span className="break-all whitespace-pre-wrap">{line}</span>
                                            </div>
                                          );
                                        })}

                                        {match.contextAfter.length < 6 && (
                                          <div className="text-[10px] text-orange-500 font-semibold bg-orange-500/5 border border-orange-500/10 rounded px-2.5 py-1 mt-2">
                                            ⚠ [边界提示] 已经到达日志结尾，后置上下文实际只有 {match.contextAfter.length} 行
                                          </div>
                                        )}
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            );
                          };

                          return (
                            <div className="space-y-6">
                              {/* 1. LT OFF Section */}
                              <div className="space-y-2.5">
                                <div className="flex items-center gap-2 px-1 py-1 bg-slate-100 rounded-lg max-w-max">
                                  <span className="w-2 h-2 rounded-full bg-slate-400 ml-1.5" />
                                  <span className="text-[11px] font-bold text-slate-700 pr-2 font-mono">
                                    LT OFF 状态故障记录 ({ltOffMatches.length} 处)
                                  </span>
                                </div>
                                {ltOffMatches.length === 0 ? (
                                  <div className="bg-slate-50 border border-slate-200/50 rounded-xl p-4 text-xs text-[#86868b] leading-relaxed">
                                    如实报告：日志该区间中未检测到处于 LT OFF 模式下的 uc_sts 错误，表现良好。
                                  </div>
                                ) : (
                                  <div className="space-y-3">
                                    {ltOffMatches.map((match, idx) => renderFaultItem(match, idx, '#475569', '#f1f5f9', 'LT_OFF'))}
                                  </div>
                                )}
                              </div>

                              {/* 2. LT ON Section */}
                              <div className="space-y-2.5">
                                <div className="flex items-center gap-2 px-1 py-1 bg-blue-50 border border-blue-100/40 rounded-lg max-w-max">
                                  <span className="w-2 h-2 rounded-full bg-blue-500 ml-1.5 animate-pulse" />
                                  <span className="text-[11px] font-bold text-blue-700 pr-2 font-mono">
                                    LT ON 状态故障记录 ({ltOnMatches.length} 处)
                                  </span>
                                </div>
                                {ltOnMatches.length === 0 ? (
                                  <div className="bg-blue-500/[0.02] border border-blue-500/5 rounded-xl p-4 text-xs text-[#86868b] leading-relaxed">
                                    如实报告：日志该区间中未检测到处于 LT ON 模式下的 uc_sts 错误，表现良好。
                                  </div>
                                ) : (
                                  <div className="space-y-3">
                                    {ltOnMatches.map((match, idx) => renderFaultItem(match, idx, '#2563eb', '#eff6ff', 'LT_ON'))}
                                  </div>
                                )}
                              </div>

                              {/* 3. UNKNOWN Section - only output when present as per guidelines */}
                              {ltUnknownMatches.length > 0 && (
                                <div className="space-y-2.5">
                                  <div className="flex items-center gap-2 px-1 py-1 bg-orange-50 border border-orange-100/45 rounded-lg max-w-max">
                                    <span className="w-2 h-2 rounded-full bg-orange-400 ml-1.5" />
                                    <span className="text-[11px] font-bold text-orange-700 pr-2 font-mono">
                                      未标记 LT 情形故障记录 ({ltUnknownMatches.length} 处)
                                    </span>
                                  </div>
                                  <div className="space-y-3">
                                    {ltUnknownMatches.map((match, idx) => renderFaultItem(match, idx, '#ea580c', '#fff7ed', 'LT_UNSPEC'))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>

                      {/* Section 3: Port Link states under LT OFF/ON conditions */}
                      <div className="bg-white rounded-2xl p-5 border border-black/5 shadow-sm space-y-4">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-[#0071e3]" />
                          <h3 className="text-xs font-bold text-[#1d1d1f] uppercase tracking-wider">
                            三、各端口 Link 状态探测及 Link Training (LT) 聚合看板
                          </h3>
                        </div>
                        <p className="text-[11.5px] text-[#86868b] leading-relaxed">
                          调试引擎实时扫描、溯源与重构全量日志，分别侦测各 Port 在 <b>LT OFF</b> 阶段与 <b>LT ON</b> 阶段捕获到的最后物理链路电平（UP 或 DOWN），如实呈报：
                        </p>

                        {faultAnalysis.ltOffPorts.length === 0 && faultAnalysis.ltOnPorts.length === 0 ? (
                          <div className="bg-slate-50 border border-slate-200/50 rounded-xl p-6 text-center text-xs text-[#86868b] leading-relaxed">
                            💡 日志通篇扫描完毕。未检测到含有 `port` 或 `link up / down` 物理链路状态转变的典型行记录。
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 pt-1">
                            {/* LT OFF card */}
                            <div className="bg-[#fcfdfd] border border-black/[0.04] rounded-xl p-4.5 space-y-3.5">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                                  <span className="text-[11px] font-bold text-slate-700 font-mono">
                                    LT OFF 状态下端口状态
                                  </span>
                                </div>
                                <span className="bg-slate-100 text-slate-600 text-[9px] font-mono font-semibold px-2 py-0.5 rounded-full">
                                  已识别 {faultAnalysis.ltOffPorts.length} 个端口
                                </span>
                              </div>

                              {/* UP ports highlights */}
                              <div className="bg-white border border-slate-100 rounded-lg p-3 space-y-1.5">
                                <span className="text-[9px] font-semibold text-[#86868b] block font-mono uppercase tracking-wider">
                                  🟢 处于 LINK UP 状态的端口 ({faultAnalysis.ltOffUpPorts.length} 个)
                                </span>
                                {faultAnalysis.ltOffUpPorts.length === 0 ? (
                                  <span className="text-[10px] text-slate-400 font-mono block italic">
                                    暂无端口处于 UP 状态
                                  </span>
                                ) : (
                                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                                    {faultAnalysis.ltOffPorts.filter(p => p.state === 'UP').map(p => (
                                      <span key={p.port} className="bg-[#e3f9e5] text-[#24a148] font-mono text-[10px] font-bold px-2 py-0.5 rounded-md border border-[#24a148]/10" title={p.phyPort ? `物理端口: ${p.phyPort}` : undefined}>
                                        {p.port}{p.phyPort ? ` (Phy ${p.phyPort})` : ''}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Ports table/list detailing */}
                              <div className="space-y-1.5">
                                <span className="text-[9px] font-semibold text-[#86868b] block font-mono uppercase tracking-wider">
                                  📋 端口链路电平记录清单
                                </span>
                                {faultAnalysis.ltOffPorts.length === 0 ? (
                                  <span className="text-[10px] text-slate-400 block font-mono">
                                    无记录
                                  </span>
                                ) : (
                                  <div className="divide-y divide-black/[0.03] bg-white border border-slate-100 rounded-lg overflow-hidden max-h-[180px] overflow-y-auto custom-scrollbar">
                                    {faultAnalysis.ltOffPorts.map(p => (
                                      <div key={p.port} className="flex justify-between items-center px-3 py-2 text-[11px]">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                          <span className="font-mono font-semibold text-slate-800 truncate">{p.port}</span>
                                          {p.phyPort && (
                                            <span className="bg-slate-100 text-[#86868b] border border-black/[0.04] text-[9px] font-mono px-1 rounded shrink-0">
                                              Phy {p.phyPort}
                                            </span>
                                          )}
                                          <span className="text-[9px] text-[#86868b] font-mono shrink-0">L{p.lineNum}</span>
                                        </div>
                                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold font-mono ${
                                          p.state === 'UP' 
                                            ? 'bg-[#e3f9e5] text-[#24a148]' 
                                            : 'bg-red-50 text-red-500 border border-red-500/10'
                                        }`}>
                                          {p.state}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* LT ON card */}
                            <div className="bg-[#f9fbff] border border-blue-500/[0.04] rounded-xl p-4.5 space-y-3.5">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                                  <span className="text-[11px] font-bold text-blue-700 font-mono">
                                    LT ON 状态下端口状态
                                  </span>
                                </div>
                                <span className="bg-blue-50 text-blue-600 text-[9px] font-mono font-semibold px-2 py-0.5 rounded-full">
                                  已识别 {faultAnalysis.ltOnPorts.length} 个端口
                                </span>
                              </div>

                              {/* UP ports highlights */}
                              <div className="bg-white border border-blue-500/[0.03] rounded-lg p-3 space-y-1.5">
                                <span className="text-[9px] font-semibold text-[#86868b] block font-mono uppercase tracking-wider">
                                  🟢 处于 LINK UP 状态的端口 ({faultAnalysis.ltOnUpPorts.length} 个)
                                </span>
                                {faultAnalysis.ltOnUpPorts.length === 0 ? (
                                  <span className="text-[10px] text-slate-400 font-mono block italic">
                                    暂无端口处于 UP 状态
                                  </span>
                                ) : (
                                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                                    {faultAnalysis.ltOnPorts.filter(p => p.state === 'UP').map(p => (
                                      <span key={p.port} className="bg-[#eff6ff] text-[#2563eb] font-mono text-[10px] font-bold px-2 py-0.5 rounded-md border border-[#2563eb]/10" title={p.phyPort ? `物理端口: ${p.phyPort}` : undefined}>
                                        {p.port}{p.phyPort ? ` (Phy ${p.phyPort})` : ''}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Ports table/list detailing */}
                              <div className="space-y-1.5">
                                <span className="text-[9px] font-semibold text-[#86868b] block font-mono uppercase tracking-wider">
                                  📋 端口链路电平记录清单
                                </span>
                                {faultAnalysis.ltOnPorts.length === 0 ? (
                                  <span className="text-[10px] text-slate-400 block font-mono">
                                    无记录
                                  </span>
                                ) : (
                                  <div className="divide-y divide-black/[0.03] bg-white border border-blue-500/[0.03] rounded-lg overflow-hidden max-h-[180px] overflow-y-auto custom-scrollbar">
                                    {faultAnalysis.ltOnPorts.map(p => (
                                      <div key={p.port} className="flex justify-between items-center px-3 py-2 text-[11px]">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                          <span className="font-mono font-semibold text-slate-800 truncate">{p.port}</span>
                                          {p.phyPort && (
                                            <span className="bg-slate-100 text-[#86868b] border border-black/[0.04] text-[9px] font-mono px-1 rounded shrink-0">
                                              Phy {p.phyPort}
                                            </span>
                                          )}
                                          <span className="text-[9px] text-[#86868b] font-mono shrink-0">L{p.lineNum}</span>
                                        </div>
                                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold font-mono ${
                                          p.state === 'UP' 
                                            ? 'bg-[#e3f9e5] text-[#24a148]' 
                                            : 'bg-red-50 text-red-500 border border-red-500/10'
                                        }`}>
                                          {p.state}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>


                    </motion.div>
                  )}
                </AnimatePresence>
                </div>
              </div>
            </>
          )}
        </section>
      </main>

      {/* Footer / Status Bar */}
      <footer className="fixed bottom-0 left-0 right-0 h-8 bg-white/80 backdrop-blur-md border-t border-black/5 px-6 flex justify-between items-center text-[10px] text-[#86868b] font-medium z-50">
        <div className="flex gap-6">
          <span className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${
              appMode === 'all' 
                ? (extractedCommands.length > 0 ? 'bg-green-500' : 'bg-orange-400')
                : appMode === 'targeted'
                ? (results ? 'bg-green-500' : 'bg-orange-400')
                : (logContent ? 'bg-green-500' : 'bg-orange-400')
            }`} />
            状态: {appMode === 'all' ? (extractedCommands.length > 0 ? '就绪' : '空闲') : appMode === 'targeted' ? (results ? '就绪' : '空闲') : (logContent ? '芯片诊断已就绪' : '等待日志')}
          </span>
          {appMode === 'all' ? (
            extractedCommands.length > 0 && <span>汇整全指令: {extractedCommands.length} 条</span>
          ) : appMode === 'targeted' ? (
            results && <span>总匹配项: {results.length}</span>
          ) : (
            logContent && (
              <span>
                型号: {faultAnalysis.productModel}{faultAnalysis.sdkVersion ? ` (${faultAnalysis.sdkVersion})` : ''} | uc_sts 错误: {faultAnalysis.ucStsMatches.length} 处
              </span>
            )
          )}
        </div>
        <div className="flex gap-4">
          <span>Created by Kevin</span>
          <span className="opacity-40">|</span>
          <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </footer>
    </div>
  );
}
