# 🤝 دليل المساهمة في نظام حاضر
# Contributing to HADER System

شكراً لاهتمامك بالمساهمة في نظام حاضر! نحن نرحب بجميع أنواع المساهمات.

Thank you for your interest in contributing to HADER System! We welcome all types of contributions.

---

## 📋 جدول المحتويات / Table of Contents

- [كيف يمكنني المساهمة؟ / How Can I Contribute?](#how-can-i-contribute)
- [الإبلاغ عن الأخطاء / Reporting Bugs](#reporting-bugs)
- [اقتراح ميزات جديدة / Suggesting Features](#suggesting-features)
- [إرشادات الكود / Code Guidelines](#code-guidelines)
- [عملية Pull Request](#pull-request-process)

---

## 🚀 كيف يمكنني المساهمة؟
## How Can I Contribute?

### 1️⃣ الإبلاغ عن الأخطاء / Reporting Bugs

قبل إنشاء تقرير خطأ، يرجى التحقق من:
Before creating a bug report, please check:

- ✅ البحث في [Issues الموجودة](https://github.com/HimArt-1/Hader/issues)
- ✅ التأكد من أن الخطأ ليس بسبب خطأ في الإعداد
- ✅ جمع معلومات كافية عن الخطأ

#### كيفية كتابة تقرير خطأ جيد:

```markdown
## 🐛 وصف الخطأ / Bug Description
وصف واضح ومختصر للخطأ

## 📋 خطوات إعادة الإنتاج / Steps to Reproduce
1. اذهب إلى '...'
2. اضغط على '...'
3. انتقل إلى '...'
4. لاحظ الخطأ

## ✅ السلوك المتوقع / Expected Behavior
ما كنت تتوقع أن يحدث

## ❌ السلوك الفعلي / Actual Behavior
ما حدث بالفعل

## 🖼️ لقطات الشاشة / Screenshots
إن أمكن، أرفق لقطات شاشة

## 🌐 البيئة / Environment
- نظام التشغيل: [e.g. Windows 10, macOS 13]
- المتصفح: [e.g. Chrome 120, Firefox 121]
- نسخة النظام: [e.g. v2.0.0]

## 📝 معلومات إضافية / Additional Context
أي معلومات أخرى مفيدة
```

### 2️⃣ اقتراح ميزات جديدة / Suggesting Features

لاقتراح ميزة جديدة:

1. **افتح Issue جديدة** مع عنوان واضح
2. **اشرح المشكلة** التي تحلها الميزة
3. **وضح الحل المقترح** بالتفصيل
4. **أضف أمثلة** إن أمكن

#### قالب اقتراح ميزة:

```markdown
## 💡 الميزة المقترحة / Feature Suggestion
وصف واضح للميزة

## 🎯 المشكلة / Problem
ما هي المشكلة التي تحلها هذه الميزة؟

## ✨ الحل المقترح / Proposed Solution
كيف يجب أن تعمل الميزة؟

## 🔄 البدائل / Alternatives
هل فكرت في حلول بديلة؟

## 📊 تأثير الميزة / Impact
من سيستفيد من هذه الميزة؟
```

### 3️⃣ المساهمة بالكود / Code Contributions

#### Fork وClone المشروع

```bash
# Fork المشروع على GitHub
# ثم clone النسخة الخاصة بك

git clone https://github.com/your-username/Hader.git
cd Hader

# إضافة المستودع الأصلي كـ upstream
git remote add upstream https://github.com/HimArt-1/Hader.git
```

#### إنشاء فرع جديد

```bash
# تحديث فرع main
git checkout main
git pull upstream main

# إنشاء فرع للميزة الجديدة
git checkout -b feature/amazing-feature

# أو لإصلاح خطأ
git checkout -b fix/bug-description
```

#### تطوير الميزة

1. **اكتب كود نظيف** واتبع معايير المشروع
2. **أضف اختبارات** للميزات الجديدة
3. **حدّث الوثائق** إذا لزم الأمر
4. **اختبر التغييرات** محلياً

```bash
# تشغيل المشروع
npm run dev

# تشغيل الاختبارات
npm run test

# بناء المشروع
npm run build
```

---

## 📝 إرشادات الكود
## Code Guidelines

### TypeScript

```typescript
// ✅ جيد / Good
interface Student {
  id: string;
  name: string;
  class_name: string;
  section: string;
}

async function getStudents(): Promise<Student[]> {
  // Implementation
}

// ❌ سيء / Bad
function getStudents() {
  // No types
}
```

### تسمية الملفات / File Naming

- **مكونات React**: `PascalCase.tsx` (e.g., `StudentCard.tsx`)
- **الخدمات**: `camelCase.ts` (e.g., `authService.ts`)
- **الأدوات**: `camelCase.ts` (e.g., `validation.ts`)
- **الأنواع**: `camelCase.ts` أو `types.ts`

### معايير الكود / Code Standards

```typescript
// ✅ استخدم const/let بدلاً من var
const userId = '123';
let count = 0;

// ✅ استخدم Arrow Functions
const handleClick = () => {
  console.log('clicked');
};

// ✅ استخدم Optional Chaining
const userName = user?.profile?.name;

// ✅ استخدم Async/Await بدلاً من Promises
async function fetchData() {
  try {
    const data = await api.getData();
    return data;
  } catch (error) {
    handleError(error);
  }
}

// ✅ أضف JSDoc للدوال المعقدة
/**
 * Calculate late minutes based on assembly time
 * @param arrivalTime - Student arrival timestamp
 * @param assemblyTime - School assembly time
 * @returns Number of late minutes
 */
function calculateLateMinutes(
  arrivalTime: string,
  assemblyTime: string
): number {
  // Implementation
}
```

### React Components

```typescript
// ✅ استخدم Functional Components
import React, { useState } from 'react';

interface Props {
  student: Student;
  onSelect: (id: string) => void;
}

export const StudentCard: React.FC<Props> = ({ student, onSelect }) => {
  const [selected, setSelected] = useState(false);

  return (
    <div onClick={() => onSelect(student.id)}>
      {student.name}
    </div>
  );
};

// ✅ استخدم Custom Hooks للمنطق المشترك
function useStudentData(studentId: string) {
  const [student, setStudent] = useState<Student | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStudent(studentId).then(setStudent).finally(() => setLoading(false));
  }, [studentId]);

  return { student, loading };
}
```

### CSS / TailwindCSS

```tsx
// ✅ استخدم TailwindCSS classes
<div className="glass-card border border-white/10 rounded-2xl p-6">
  <h2 className="text-2xl font-bold text-white">العنوان</h2>
</div>

// ✅ استخدم الفئات المخصصة للتصاميم المتكررة
// في index.css
.glass-card {
  @apply bg-white/5 backdrop-blur-xl border border-white/10;
}
```

---

## 🔄 عملية Pull Request
## Pull Request Process

### 1. التحقق قبل الإرسال

```bash
# تشغيل الاختبارات
npm run test

# التحقق من TypeScript
npx tsc --noEmit

# بناء المشروع
npm run build
```

### 2. Commit التغييرات

استخدم رسائل commit واضحة:

```bash
# ✅ جيد
git commit -m "feat: Add manual absence recording feature"
git commit -m "fix: Resolve authentication timeout issue"
git commit -m "docs: Update README with new features"
git commit -m "refactor: Improve database query performance"

# ❌ سيء
git commit -m "updates"
git commit -m "fix stuff"
```

#### أنواع Commits

- `feat:` - ميزة جديدة
- `fix:` - إصلاح خطأ
- `docs:` - تحديث الوثائق
- `style:` - تنسيق الكود (لا يؤثر على المنطق)
- `refactor:` - إعادة هيكلة الكود
- `test:` - إضافة أو تحديث الاختبارات
- `chore:` - مهام صيانة

### 3. Push إلى Fork الخاص بك

```bash
git push origin feature/amazing-feature
```

### 4. فتح Pull Request

1. اذهب إلى المستودع الأصلي على GitHub
2. اضغط "New Pull Request"
3. اختر fork الخاص بك والفرع
4. املأ قالب PR:

```markdown
## 📝 الوصف / Description
وصف واضح للتغييرات

## 🎯 نوع التغيير / Type of Change
- [ ] ميزة جديدة / New feature
- [ ] إصلاح خطأ / Bug fix
- [ ] تحديث الوثائق / Documentation
- [ ] تحسين الأداء / Performance
- [ ] إعادة هيكلة / Refactoring

## ✅ قائمة التحقق / Checklist
- [ ] تم اختبار الكود محلياً
- [ ] تمت إضافة/تحديث الاختبارات
- [ ] تمت إضافة/تحديث الوثائق
- [ ] الكود يتبع معايير المشروع
- [ ] لا توجد أخطاء TypeScript

## 📸 لقطات الشاشة / Screenshots
إن وجدت

## 📋 المهام المرتبطة / Related Issues
Closes #123
```

### 5. مراجعة الكود

- سيتم مراجعة PR الخاص بك
- قد يُطلب منك إجراء تعديلات
- ناقش التعليقات بشكل بناء
- قم بإجراء التعديلات المطلوبة

```bash
# إجراء تعديلات إضافية
git add .
git commit -m "refactor: Address review comments"
git push origin feature/amazing-feature
```

---

## 🧪 الاختبارات / Testing

### كتابة الاختبارات

```typescript
// __tests__/StudentCard.spec.tsx
import { render, screen } from '@testing-library/react';
import { StudentCard } from '../components/StudentCard';

describe('StudentCard', () => {
  it('should render student name', () => {
    const student = {
      id: '1',
      name: 'أحمد محمد',
      class_name: '3-أ',
      section: 'الفصل 1'
    };

    render(<StudentCard student={student} onSelect={() => {}} />);

    expect(screen.getByText('أحمد محمد')).toBeInTheDocument();
  });
});
```

---

## 📚 الموارد / Resources

- [React Documentation](https://reactjs.org/docs)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [TailwindCSS Docs](https://tailwindcss.com/docs)
- [Supabase Docs](https://supabase.com/docs)
- [Vitest Documentation](https://vitest.dev/)

---

## ❓ الأسئلة / Questions

إذا كان لديك أي أسئلة:

- 📖 راجع [الوثائق](README.md)
- 💬 افتح [Discussion](https://github.com/HimArt-1/Hader/discussions)
- 🐛 أبلغ عن [Issue](https://github.com/HimArt-1/Hader/issues)

---

## 🙏 شكراً / Thank You!

شكراً لمساهمتك في تحسين نظام حاضر!
Thank you for contributing to HADER System!

---

<div align="center">

**صُنع بـ ❤️ في السعودية*

**صُنع بـ ❤️ من قبل أ.هيثم**
*

**Made with ❤️ by the Community**

</div>
