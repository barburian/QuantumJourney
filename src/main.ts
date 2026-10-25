import './styles.css';
import { EXAMPLES } from './examples';
import { initExport } from './exportView';
import { loadStoredGates } from './gateStore';
import { initInteraction } from './interaction';
import { buildExample, initLibrary, renderLibrary } from './library';
import { initMatrix } from './matrixView';
import { initScope } from './scope';
import { initToolbar } from './toolbar';

loadStoredGates();
initLibrary();
initScope();
initToolbar();
initInteraction();
initMatrix();
initExport();
renderLibrary();
buildExample(EXAMPLES[0]);
