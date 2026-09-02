# HADER AI PACKAGE - التقنيات المقترحة

## 06-TECH-STACK.md

### التوصية الأساسية (Core Recommendation)
لبناء نسخة حديثة، مستقرة، وسريعة تدعم العمل دون اتصال بشكل كامل (Local-First)، نوصي بالحزمة التالية:

#### 1. الواجهة الأمامية (Frontend)
*   **Framework:** React 18+ (مع Vite لسرعة التطوير والبناء).
*   **Language:** TypeScript (لضمان نوع البيانات وتقليل الأخطاء).
*   **Routing:** React Router v6.
*   **PWA:** `vite-plugin-pwa` (لتحويل الموقع لتطبيق قابل للتثبيت ودعم العمل أوفلاين عبر Service Workers).

#### 2. تصميم الواجهة (UI & UX)
*   **Styling:** Tailwind CSS (للمرونة والسرعة).
*   **Components:** Shadcn/UI (مكونات جاهزة، جميلة، وقابلة للتخصيص مبنية على Radix UI).
*   **Icons:** Lucide React (أيقونات خفيفة وعصرية).
*   **Animations:** Framer Motion (للتفاعلات السلسة خاصة في الكiosk).

#### 3. إدارة الحالة والبيانات (State & Data)
*   **Local Database:** **Dexie.js** (مكتبة قوية لـ IndexedDB) بدلاً من LocalStorage. أسرع وتدعم استعلامات معقدة وحجم بيانات أكبر.
*   **Sync Engine:** بناء طبقة مزامنة مخصصة (Custom Sync Layer) أو استخدام **RxDB** إذا كانت الميزانية تسمح لتعقيد أقل في الكود.
*   **Global State:** Zustand (خفيف وسهل جداً مقارنة بـ Redux).
*   **Server State:** TanStack Query (React Query) لإدارة جلب البيانات والتخزين المؤقت.

#### 4. الخلفية (Backend)
*   **Provider:** **Supabase** (خيار ممتاز يوفر Postgres Database + Auth + Edge Functions).
*   **Auth:** Supabase Auth (دعم تسجيل الدخول برقم الهاتف أو الإيميل).
*   **Realtime:** Supabase Realtime (تحديثات فورية للأجهزة المتصلة).

#### 5. أدوات أخرى (Tools)
*   **Testing:** Vitest (للاختبارات الوحدية)، Playwright (لاختبارات التصفح E2E).
*   **Deploy:** Vercel (الأسهل والأسرع لـ React).
*   **Messaging:** WhatsApp Business API (أو مزود خدمة وسيط مثل UltraMsg/Twilio).
