export interface AppDefinition {
  id: string;
  name: string;
  keys: string[];
  desc: string;
  icon: string;
  fallbackIcon: string;
  openType: 'calculator' | 'cric-yuva' | 'external';
  openUrl?: string;
  apkKeywords: string[];
  defaultApk?: string;
}

export interface CatalogApp extends AppDefinition {
  apkUrl: string;
  version: string;
  updatedLabel: string;
  isLatest: boolean;
  hasUpdate: boolean;
  sha?: string;
}

export interface CalculationItem {
  id: string;
  expression: string;
  answer: string;
  timestamp: number;
}

export interface CricPlayer {
  id: string;
  name: string;
  battingStyle?: string;
  bowlingStyle?: string;
}

export interface CricTeam {
  id: string;
  teamName: string;
  players?: CricPlayer[];
}

export interface BatsmanStats {
  name: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  outStatus: string;
}

export interface BowlerStats {
  name: string;
  overs: number;
  ballsInOver: number;
  runsConceded: number;
  wickets: number;
  maidens: number;
}

export interface MatchConfig {
  teamAName: string;
  teamBName: string;
  maxOvers: number;
  ballType: string;
  tossWinner: string;
  tossDecision: 'Batting' | 'Bowling';
  strikerName: string;
  nonStrikerName: string;
  bowlerName: string;
}

export interface MatchState {
  config: MatchConfig;
  currentInnings: 1 | 2;
  battingTeam: string;
  bowlingTeam: string;
  runs: number;
  wickets: number;
  overs: number;
  ballsInCurrentOver: number;
  targetRuns: number | null;
  striker: BatsmanStats;
  nonStriker: BatsmanStats;
  currentBowler: BowlerStats;
  batsmenScorecard: Record<string, BatsmanStats>;
  bowlersScorecard: Record<string, BowlerStats>;
  thisOverBalls: string[];
  isMatchFinished: boolean;
  resultMessage: string;
}
