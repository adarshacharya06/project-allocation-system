const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// ============ CORS CONFIGURATION ============
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Add this header for additional CORS support
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// MongoDB Connection
const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/project-allocation';

mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log('✅ MongoDB Connected Successfully');
  console.log(`📍 Database: project-allocation`);
})
.catch(err => {
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
  timestamp: { type: Date, default: Date.now }
});

const professorSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, sparse: true },
  department: String,
  expertise: String,
  capacity: Number,
  timestamp: { type: Date, default: Date.now }
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
  timestamp: { type: Date, default: Date.now }
});

const Student = mongoose.model('Student', studentSchema);
const Professor = mongoose.model('Professor', professorSchema);
const Allocation = mongoose.model('Allocation', allocationSchema);

// ============ SMART ALLOCATION ALGORITHM ============

async function smartAllocationAlgorithm() {
  try {
    const students = await Student.find().sort({ cgpa: -1 });
    const professors = await Professor.find();
    
    if (students.length === 0 || professors.length === 0) {
      throw new Error('No students or professors found');
    }

    // Track professor allocations and capacity
    const professorAllocations = {};
    professors.forEach(prof => {
      professorAllocations[prof.name] = {
        allocations: [],
        capacity: prof.capacity || 5,
        expertise: prof.expertise || ''
      };
    });

    const allocations = [];

    // Allocate students based on preferences, CGPA, and domain match
    for (const student of students) {
      let allocated = false;
      let allocationScore = 0;
      let assignedProfessor = null;
      let preferenceRank = 0;

      // Try to allocate based on preferences (1st choice first, then 2nd, then 3rd)
      for (let prefIndex = 0; prefIndex < student.preferences.length; prefIndex++) {
        const prefProfName = student.preferences[prefIndex];
        
        const professor = professors.find(p => p.name === prefProfName);
        
        if (professor && professorAllocations[prefProfName]) {
          const profData = professorAllocations[prefProfName];
          
          if (profData.allocations.length < profData.capacity) {
            let score = 100 - (prefIndex * 20);
            score += student.cgpa * 5;
            
            if (profData.expertise && student.domain && 
                profData.expertise.toLowerCase().includes(student.domain.toLowerCase())) {
              score += 30;
            }
            
            profData.allocations.push({
              studentName: student.name,
              studentEmail: student.email
            });
            
            assignedProfessor = professor.name;
            preferenceRank = prefIndex + 1;
            allocationScore = score;
            allocated = true;
            break;
          }
        }
      }

      // If not allocated through preferences, find best available professor
      if (!allocated) {
        let bestProfessor = null;
        let bestScore = -1;

        for (const prof of professors) {
          if (professorAllocations[prof.name].allocations.length < professorAllocations[prof.name].capacity) {
            let score = 50;

            if (prof.expertise && student.domain && 
                prof.expertise.toLowerCase().includes(student.domain.toLowerCase())) {
              score += 40;
            }

            score += student.cgpa * 3;
            score += (20 - professorAllocations[prof.name].allocations.length) * 2;

            if (score > bestScore) {
              bestScore = score;
              bestProfessor = prof;
            }
          }
        }

        if (bestProfessor) {
          professorAllocations[bestProfessor.name].allocations.push({
            studentName: student.name,
            studentEmail: student.email
          });

          assignedProfessor = bestProfessor.name;
          preferenceRank = 0;
          allocationScore = bestScore;
          allocated = true;
        }
      }

      if (allocated) {
        allocations.push({
          studentName: student.name,
          studentEmail: student.email,
          studentRoll: student.roll,
          studentCGPA: student.cgpa,
          studentDomain: student.domain,
          professorName: assignedProfessor,
          preferenceRank: preferenceRank,
          allocationScore: Math.round(allocationScore)
        });
      }
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
      firstChoice: allocationCount > 0 ? Math.round((firstChoice / totalStudents) * 100) : 0
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
  console.log('🧠 Smart allocation algorithm enabled\n');
});