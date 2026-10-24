import './styles.css';
import { EXAMPLES } from './examples';
import { initInteraction } from './interaction';
import { buildExample, initLibrary, renderLibrary } from './library';
import { initToolbar } from './toolbar';

initLibrary();
initToolbar();
initInteraction();
renderLibrary();
buildExample(EXAMPLES[0]);
