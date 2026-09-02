
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, Search } from 'lucide-react';

const NotFound: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center">
      <div className="w-40 h-40 bg-white/5 rounded-full flex items-center justify-center mb-8 border border-white/10 relative">
          <div className="absolute inset-0 bg-primary-500/20 blur-3xl rounded-full animate-pulse"></div>
          <Search className="w-20 h-20 text-gray-500" />
      </div>
      
      <h1 className="text-8xl font-bold font-serif text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-secondary-400 mb-4">404</h1>
      <h2 className="text-2xl font-bold text-white mb-2">الصفحة غير موجودة</h2>
      <p className="text-gray-400 max-w-md mb-8">عذراً، الرابط الذي تحاول الوصول إليه غير صحيح أو تم نقله.</p>
      
      <button 
        onClick={() => navigate('/')}
        className="px-8 py-3 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-white font-bold transition-all flex items-center gap-2"
      >
        <Home className="w-5 h-5" />
        العودة للرئيسية
      </button>
    </div>
  );
};

export default NotFound;
