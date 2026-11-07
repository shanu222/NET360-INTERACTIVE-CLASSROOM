import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './styles.css';
import { AuthProvider } from './lib/auth.tsx';
import { setSlideUrl } from '@net360/board-engine';
import { API_URL } from './lib/env.ts';

// Slide images live on the realtime server.
setSlideUrl((img) => `${API_URL}/api/slides/${img}`);
import Home from './pages/Home.tsx';
import Join from './pages/Join.tsx';
import Student from './pages/Student.tsx';
import Teacher from './pages/Teacher.tsx';
import BoardDisplay from './pages/BoardDisplay.tsx';
import Pad from './pages/Pad.tsx';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/join" element={<Join />} />
          <Route path="/live/:sessionId" element={<Student />} />
          <Route path="/host/:sessionId" element={<Teacher />} />
          {/* Links from before meetings: still work. */}
          <Route path="/class/:sessionId" element={<Student />} />
          <Route path="/teach/:sessionId" element={<Teacher />} />
          <Route path="/board/:sessionId" element={<BoardDisplay />} />
          <Route path="/pad/:sessionId" element={<Pad />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>,
);
