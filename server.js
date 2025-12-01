const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// ============ CORS CONFIGURATION ============
app.use(
  cors({
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Extra CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// ============ MONGODB CONNECTION ============
const mongoURI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/project-allocation';

mongoose
  .connect(mongoURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log('✅ MongoDB Connected Successfully');
    console.log('📍 Database: project-allocation');
  })
  .catch((err) => {
    console.log('❌ MongoDB Connection Error:', err.message);
    console.log('⚠️  Make sure MongoDB is running with: mongod');
    process.exit(1);
  });

// ============ SCHEMAS ============
const studentSchema = new mongoose.Schema({
  roll: String,
  name: String,
  email: { type: String, unique: true, sparse: true },
  cgpa: Number,
  projectTitle: String,
  domain: String,
  preferences: [String],
  timestamp: { type: Date, default: Date.now },
});

const professorSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, sparse: true },
  department: String,
  expertise: String,
  capacity: Number,
  timestamp: { type: Date, default: Date.now },
});

const allocationSchema = new mongoose.Schema({
  studentName: String,
  studentEmail: String,
  studentRoll: String,
  studentCGPA: Number,
  studentDomain: String,
  professorName: String,
  preferenceRank: Number,
  allocationScore: Number,
  timestamp: { type: Date, default: Date.now },
});

const Student = mongoose.model('Student', studentSchema);
const Professor = mongoose.model('Professor', professorSchema);
const Allocation = mongoose.model('Allocation', allocationSchema);

// ============ SIMPLE, CAPACITY-SAFE ALGORITHM (NORMALIZED NAMES) ============
async function smartAllocationAlgorithm() {
  try {
    // Sort students: highest CGPA first
    const students = await Student.find().sort({ cgpa: -1 });
    const professors = await Professor.find();

    if (students.length === 0 || professors.length === 0) {
      throw new Error('No students or professors found');
    }

    // Track professor capacities by normalized name
    const professorState = {};
    let totalCapacity = 0;

    professors.forEach((prof) => {
      const key = (prof.name || '').trim().toLowerCase(); // normalized key
      const cap = Number(prof.capacity) || 0;

      professorState[key] = {
        displayName: prof.name, // original for UI
        used: 0,
        cap,
      };
      totalCapacity += cap;
    });

    const allocations = [];

    for (const student of students) {
      // Stop when all seats filled
      if (allocations.length >= totalCapacity) break;

      let assignedKey = null;
      let preferenceRank = 0;

      const prefs = Array.isArray(student.preferences)
        ? student.preferences
        : [];

      // Try preferences strictly in order, using normalized keys
      for (let i = 0; i < prefs.length; i++) {
        const prefKey = (prefs[i] || '').trim().toLowerCase();
        const state = professorState[prefKey];

        if (state && state.used < state.cap) {
          state.used += 1;
          assignedKey = prefKey;
          preferenceRank = i + 1; // 1, 2, 3
          break;
        }
      }

      // If no preferred professor has capacity, skip this student
      if (!assignedKey) continue;

      const state = professorState[assignedKey];

      allocations.push({
        studentName: student.name,
        studentEmail: student.email,
        studentRoll: student.roll,
        studentCGPA: student.cgpa,
        studentDomain: student.domain,
        professorName: state.displayName, // show original name
        preferenceRank,
        allocationScore: Math.round((student.cgpa || 0) * 10), // simple score
      });
    }

    return allocations;
  } catch (err) {
    console.error('Allocation algorithm error:', err);
    throw err;
  }
}

// ============ API ROUTES ============

// STUDENTS
app.post('/api/students', async (req, res) => {
  try {
    const { email } = req.body;

    let student = await Student.findOne({ email });

    if (student) {
      Object.assign(student, req.body);
      await student.save();
      res.json({ ...student.toObject(), message: 'Student updated' });
    } else {
      student = new Student(req.body);
      await student.save();
      res.json({ ...student.toObject(), message: 'Student created' });
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/students', async (req, res) => {
  try {
    const students = await Student.find().sort({ timestamp: -1 });
    res.json(students);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PROFESSORS
app.post('/api/professors', async (req, res) => {
  try {
    const { email } = req.body;

    let professor = await Professor.findOne({ email });

    if (professor) {
      Object.assign(professor, req.body);
      await professor.save();
      res.json({ ...professor.toObject(), message: 'Professor updated' });
    } else {
      professor = new Professor(req.body);
      await professor.save();
      res.json({ ...professor.toObject(), message: 'Professor created' });
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/professors', async (req, res) => {
  try {
    const professors = await Professor.find();
    res.json(professors);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// SMART ALLOCATIONS
app.post('/api/allocations/bulk', async (req, res) => {
  try {
    const allocations = await smartAllocationAlgorithm();

    await Allocation.deleteMany({});
    const result = await Allocation.insertMany(allocations);

    res.json({ count: result.length, message: 'Smart allocations completed' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/allocations', async (req, res) => {
  try {
    const allocations = await Allocation.find().sort({ allocationScore: -1 });
    res.json(allocations);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// STATS
app.get('/api/stats', async (req, res) => {
  try {
    const totalStudents = await Student.countDocuments();
    const totalProfessors = await Professor.countDocuments();
    const allocationCount = await Allocation.countDocuments();
    const firstChoice = await Allocation.countDocuments({ preferenceRank: 1 });

    res.json({
      totalStudents,
      totalProfessors,
      allocationCount,
      firstChoice:
        allocationCount > 0
          ? Math.round((firstChoice / totalStudents) * 100)
          : 0,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// RESET SYSTEM
app.post('/api/reset', async (req, res) => {
  try {
    await Student.deleteMany({});
    await Professor.deleteMany({});
    await Allocation.deleteMany({});
    res.json({ message: 'System reset successfully' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Serve index.html for SPA
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'Server running', timestamp: new Date() });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Open http://localhost:${PORT} in browser\n`);
  console.log('💾 Data stored in MongoDB\n');
  console.log('🧠 Smart allocation algorithm (simple capacity-safe, normalized names) enabled\n');
});
