document.addEventListener("DOMContentLoaded", () => {
  
  const ui = {};
  const elementIds = [
      "simulationCanvas", "play-pause-btn", "reset-btn", "speed-slider", "speed-value", "sidebar",
      "sidebar-toggle", "trace-view-btn", "status-badge", "status-text", "initial-alpha-pop", "initial-beta-pop", "initial-manna",
      "max-manna", "manna-spawn-rate", "mutation-rate", "mutation-strength", "overpopulation-threshold",
      "overpopulation-penalty", "initial-energy", "reproduce-threshold", "reproduce-cost", "manna-energy",
      "kill-energy", "attack-damage", "attack-cost", "home-turf-speed-penalty", "home-turf-perception-penalty",
      "home-turf-metabolism-penalty", "enemy-turf-metabolism-benefit", "generation-stat", "population-stat",
      "alpha-pop-stat", "beta-pop-stat", "alpha-speed-stat", "beta-speed-stat", "alpha-aggression-stat",
      "beta-aggression-stat", "alpha-perception-stat", "beta-perception-stat", "alpha-defense-stat",
      "beta-defense-stat", "alpha-efficiency-stat", "beta-efficiency-stat", "alpha-speed-bar", "beta-speed-bar",
      "alpha-aggression-bar", "beta-aggression-bar", "alpha-perception-bar", "beta-perception-bar",
      "alpha-defense-bar", "beta-defense-bar", "alpha-efficiency-bar", "beta-efficiency-bar",
      "generation-length", "organism-size", "path-history", "low-energy-threshold", "flee-energy-threshold",
      "max-age", "senescence-start-factor", "patch-generation-interval", "num-patches", "patch-radius",
      "patch-distribution-std-dev", "environment-rotation-speed", "dark-color", "light-color", "trace-view-bg",
      "gene-speed-min", "gene-speed-max", "gene-aggression-min", "gene-aggression-max", "gene-perception-min",
      "gene-perception-max", "gene-perception-cost", "gene-defense-min", "gene-defense-max", "gene-defense-speed-penalty",
      "gene-efficiency-min", "gene-efficiency-max", "overpopulation-stress-radius", "predator-efficiency", "metabolism"
  ];
  elementIds.forEach(id => {
      const key = id.replace(/-(\w)/g, (_, letter) => letter.toUpperCase());
      ui[key] = document.getElementById(id);
  });

  const ctx = ui.simulationCanvas.getContext("2d");

  
  let organisms = [];
  let manna = [];
  let isRunning = true;
  let gameSpeed = 1;
  let frameCount = 0;
  let generation = 1;
  let nextOrgId = 0;
  let quadtree;
  let isTraceView = false;
  let fertilePatches = [];
  let environment = { angle: 0 };
  
  // Population tracking for trends
  let populationHistory = {
    alpha: [],
    beta: [],
    maxHistory: 30
  };

  
  const config = {
    generationLengthInFrames: 1200, initialAlphaPop: 100, initialBetaPop: 100, initialManna: 150,
    maxManna: 200, mannaSpawnRate: 1, organismSize: 4, pathHistoryLength: 150, lowEnergyThreshold: 50,
    fleeEnergyThreshold: 60, maxAge: 6000, senescenceStartFactor: 0.8, patchGenerationInterval: 800,
    numPatches: 8, patchRadius: 80, patchDistributionStdDev: 0.2,
    overpopulation: { stressRadius: 20, threshold: 5, penalty: 0.05 },
    energy: { initial: 100, fromManna: 25, fromKill: 75, predatorDamage: 40, predatorEfficiency: 0.8,
              reproduceCost: 90, reproduceThreshold: 160, metabolism: 0.1, attackCost: 8 },
    mutation: { rate: 0.1, strength: 0.1 },
    genes: {
      speed: { min: 0.5, max: 4.0 }, aggression: { min: 0, max: 2.0 },
      perception: { min: 40, max: 120, cost: 0.001 }, defense: { min: 0, max: 2.0, speedPenalty: 0.6 },
      efficiency: { min: 0.8, max: 2.0 },
    },
    environment: {
      rotationSpeed: 0.0005, darkColor: "#1E1E1E", lightColor: "#FFFFFF", traceViewBg: "#008080",
      homeTurfSpeedPenalty: 0.8, homeTurfPerceptionPenalty: 0.8, homeTurfMetabolismPenalty: 1.8,
      enemyTurfMetabolismBenefit: 0.8,
    },
  };

  
  function randomGaussian(mean, stdDev) {
    let u1, u2;
    do { u1 = Math.random(); u2 = Math.random(); } while (u1 === 0);
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return z0 * stdDev + mean;
  }

  function getPercent(value, min, max) { return max > min ? ((value - min) / (max - min)) * 100 : 0; }

  function mutateGene(value, geneConfig, mutationRate, mutationStrength) {
      if (Math.random() < mutationRate) {
          const mutationAmount = (Math.random() - 0.5) * 2 * mutationStrength;
          value += mutationAmount * (geneConfig.max - geneConfig.min);
      }
      return Math.max(geneConfig.min, Math.min(geneConfig.max, value));
  }

  
  class Rectangle { constructor(x, y, w, h) { this.x = x; this.y = y; this.w = w; this.h = h; } contains(point) { return ( point.x >= this.x - this.w && point.x <= this.x + this.w && point.y >= this.y - this.h && point.y <= this.y + this.h ); } intersects(range) { let xDist = Math.abs(range.x - this.x); let yDist = Math.abs(range.y - this.y); let r = range.r; if (xDist > this.w + r || yDist > this.h + r) return false; if (xDist <= this.w || yDist <= this.h) return true; let edges = (xDist - this.w) ** 2 + (yDist - this.h) ** 2; return edges <= (r ** 2); } }
  class Circle { constructor(x, y, r) { this.x = x; this.y = y; this.r = r; } }

  class Quadtree {
      constructor(boundary, capacity) { this.boundary = boundary; this.capacity = capacity; this.points = []; this.divided = false; }
      clear() { this.points = []; if (this.divided) { this.northeast.clear(); this.northwest.clear(); this.southeast.clear(); this.southwest.clear(); } this.divided = false; }
      subdivide() { let { x, y, w, h } = this.boundary; let ne = new Rectangle(x + w / 2, y - h / 2, w / 2, h / 2); this.northeast = new Quadtree(ne, this.capacity); let nw = new Rectangle(x - w / 2, y - h / 2, w / 2, h / 2); this.northwest = new Quadtree(nw, this.capacity); let se = new Rectangle(x + w / 2, y + h / 2, w / 2, h / 2); this.southeast = new Quadtree(se, this.capacity); let sw = new Rectangle(x - w / 2, y + h / 2, w / 2, h / 2); this.southwest = new Quadtree(sw, this.capacity); this.divided = true; }
      insert(point) { if (!this.boundary.contains(point)) return false; if (this.points.length < this.capacity) { this.points.push(point); return true; } if (!this.divided) this.subdivide(); return ( this.northeast.insert(point) || this.northwest.insert(point) || this.southeast.insert(point) || this.southwest.insert(point) ); }
      query(range, found = []) { if (!this.boundary.intersects(range)) return found; for (let p of this.points) { if (((p.x - range.x) ** 2 + (p.y - range.y) ** 2) <= (range.r ** 2)) { found.push(p); } } if (this.divided) { this.northwest.query(range, found); this.northeast.query(range, found); this.southwest.query(range, found); this.southeast.query(range, found); } return found; }
  }

  class Organism {
      constructor(x, y, species, genes = {}) {
          this.id = nextOrgId++; this.x = x; this.y = y; this.species = species;
          this.energy = config.energy.initial; this.direction = Math.random() * 2 * Math.PI;
          this.target = null; this.isOnHomeTurf = false; this.path = []; this.age = 0;
          this.speed = genes.speed ?? 1.5; this.aggression = genes.aggression ?? 0.5;
          this.efficiency = genes.efficiency ?? 1; this.perception = genes.perception ?? 75;
          this.defense = genes.defense ?? 0.1;
      }

      draw() { 
          ctx.save(); 
          ctx.translate(this.x, this.y); 
          ctx.rotate(this.direction + Math.PI / 2); 
          
          // Energy glow effect
          if (this.energy > config.energy.reproduceThreshold) {
              const glowIntensity = 0.3 + Math.sin(frameCount * 0.15) * 0.2;
              const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, config.organismSize * 3);
              gradient.addColorStop(0, `rgba(16, 185, 129, ${glowIntensity})`);
              gradient.addColorStop(1, 'rgba(16, 185, 129, 0)');
              ctx.fillStyle = gradient;
              ctx.beginPath();
              ctx.arc(0, 0, config.organismSize * 3, 0, Math.PI * 2);
              ctx.fill();
          }
          
          // Low energy warning glow
          if (this.energy < config.lowEnergyThreshold) {
              const warningIntensity = 0.2 + Math.sin(frameCount * 0.2) * 0.15;
              const warningGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, config.organismSize * 2.5);
              warningGradient.addColorStop(0, `rgba(239, 68, 68, ${warningIntensity})`);
              warningGradient.addColorStop(1, 'rgba(239, 68, 68, 0)');
              ctx.fillStyle = warningGradient;
              ctx.beginPath();
              ctx.arc(0, 0, config.organismSize * 2.5, 0, Math.PI * 2);
              ctx.fill();
          }
          
          // Main organism body with gradient
          ctx.beginPath(); 
          ctx.moveTo(0, -config.organismSize * 1.5); 
          ctx.lineTo(-config.organismSize, config.organismSize); 
          ctx.lineTo(config.organismSize, config.organismSize); 
          ctx.closePath(); 
          
          const bodyGradient = ctx.createLinearGradient(0, -config.organismSize * 1.5, 0, config.organismSize);
          if (this.species === "alpha") {
              bodyGradient.addColorStop(0, config.environment.darkColor);
              bodyGradient.addColorStop(1, '#404040');
          } else {
              bodyGradient.addColorStop(0, '#FFFFFF');
              bodyGradient.addColorStop(1, config.environment.lightColor);
          }
          ctx.fillStyle = bodyGradient;
          ctx.fill(); 
          
          // Outline with status coloring
          if (this.isOnHomeTurf) {
              ctx.strokeStyle = "#FF6347";
              ctx.lineWidth = 2;
              ctx.shadowColor = "#FF6347";
              ctx.shadowBlur = 6;
          } else {
              ctx.strokeStyle = this.species === "alpha" ? "#666" : "#999";
              ctx.lineWidth = 1.5;
              ctx.shadowBlur = 0;
          }
          ctx.stroke(); 
          
          // Direction indicator (eye)
          ctx.fillStyle = this.species === "alpha" ? "#FFFFFF" : "#000000";
          ctx.beginPath();
          ctx.arc(0, -config.organismSize * 0.5, config.organismSize * 0.3, 0, Math.PI * 2);
          ctx.fill();
          
          ctx.restore(); 
      }
      drawTrace() { 
          if (this.path.length < 2) return; 
          
          // Draw path with gradient fade effect
          for (let i = 1; i < this.path.length; i++) {
              const alpha = i / this.path.length;
              const width = 1 + alpha * 2;
              
              ctx.beginPath(); 
              ctx.moveTo(this.path[i-1].x, this.path[i-1].y); 
              ctx.lineTo(this.path[i].x, this.path[i].y); 
              
              if (this.species === "alpha") {
                  ctx.strokeStyle = `rgba(26, 26, 26, ${alpha * 0.8})`;
              } else {
                  ctx.strokeStyle = `rgba(204, 204, 204, ${alpha * 0.9})`;
              }
              ctx.lineWidth = width;
              ctx.lineCap = 'round';
              ctx.stroke(); 
          }
      }

      update(quadtree) {
          this.age++;
          if (this.age > config.maxAge) { this.energy = 0; return; }
          const currentZone = getZoneForOrganism(this);
          this.isOnHomeTurf = (this.species === "alpha" && currentZone === "light") || (this.species === "beta" && currentZone === "dark");
          let metabolicRate = config.energy.metabolism * (1 / this.efficiency) + this.perception * config.genes.perception.cost;
          if (this.isOnHomeTurf) metabolicRate *= config.environment.homeTurfMetabolismPenalty;
          else metabolicRate *= config.environment.enemyTurfMetabolismBenefit;
          const senescenceStartAge = config.maxAge * config.senescenceStartFactor;
          if (this.age > senescenceStartAge) {
              const agePenalty = (this.age - senescenceStartAge) / (config.maxAge - senescenceStartAge);
              metabolicRate *= (1 + agePenalty);
          }
          this.energy -= metabolicRate;
          if (this.energy <= 0) return;
          this.applyOverpopulationStress(quadtree);
          if (this.energy <= 0) return;
          let isFleeing = false;
          if (this.energy < config.fleeEnergyThreshold && this.target instanceof Organism) {
              this.direction = Math.atan2(this.y - this.target.y, this.x - this.target.x);
              this.target = null; isFleeing = true;
          }
          if (!isFleeing && (!this.target || this.target.energy <= 0)) {
              this.target = null; this.findTarget(quadtree);
          }
          this.move();
          if (this.energy > config.energy.reproduceThreshold) this.reproduce();
      }

      applyOverpopulationStress(quadtree) { const stressRange = new Circle(this.x, this.y, config.overpopulation.stressRadius); const neighbors = quadtree.query(stressRange); const neighborCount = neighbors.filter((p) => p instanceof Organism).length - 1; if (neighborCount > config.overpopulation.threshold) { this.energy -= (neighborCount - config.overpopulation.threshold) * config.overpopulation.penalty; } }

      findTarget(quadtree) {
          let effectivePerception = this.perception * (this.isOnHomeTurf ? (1 - config.environment.homeTurfPerceptionPenalty) : 1);
          const perceptionRange = new Circle(this.x, this.y, effectivePerception);
          const nearbyObjects = quadtree.query(perceptionRange);
          let nearestEnemy = null, nearestManna = null;
          let minEnemyDistSq = Infinity, minMannaDistSq = Infinity;
          for (const obj of nearbyObjects) {
              if (obj === this || obj.energy <= 0) continue;
              const distSq = (obj.x - this.x) ** 2 + (obj.y - this.y) ** 2;
              if (obj instanceof Organism && obj.species !== this.species) {
                  if (distSq < minEnemyDistSq) { minEnemyDistSq = distSq; nearestEnemy = obj; }
              } else if (obj instanceof Manna) {
                  if (distSq < minMannaDistSq) { minMannaDistSq = distSq; nearestManna = obj; }
              }
          }
          if (this.energy < config.lowEnergyThreshold) { this.target = nearestManna; return; }
          let willHunt = false;
          if (nearestEnemy) {
              let huntScore = this.aggression;
              if (this.energy > nearestEnemy.energy * 1.5) huntScore += 0.25;
              if (this.speed > nearestEnemy.speed) huntScore += 0.1;
              if (this.energy < config.lowEnergyThreshold * 1.2) huntScore -= 0.4;
              willHunt = Math.random() < huntScore;
          }
          this.target = willHunt ? nearestEnemy : nearestManna;
      }

      move() {
          if (this.target) {
              const dx = this.target.x - this.x; const dy = this.target.y - this.y;
              if (Math.sqrt(dx * dx + dy * dy) < config.organismSize + 2) { this.interactWithTarget(); }
              this.direction = Math.atan2(dy, dx);
          } else { this.direction += (Math.random() - 0.5) * 0.2; }
          const speedModifier = 1 - this.defense * config.genes.defense.speedPenalty;
          let currentSpeed = this.speed * speedModifier * (this.isOnHomeTurf ? (1 - config.environment.homeTurfSpeedPenalty) : 1);
          const senescenceStartAge = config.maxAge * config.senescenceStartFactor;
          if (this.age > senescenceStartAge) {
              const agePenalty = (this.age - senescenceStartAge) / (config.maxAge - senescenceStartAge);
              currentSpeed *= (1 - agePenalty * 0.75);
          }
          this.x += Math.cos(this.direction) * currentSpeed; this.y += Math.sin(this.direction) * currentSpeed;
          if (this.x < 0) { this.x = 0; this.direction += Math.PI; }
          if (this.x > ui.simulationCanvas.width) { this.x = ui.simulationCanvas.width; this.direction += Math.PI; }
          if (this.y < 0) { this.y = 0; this.direction += Math.PI; }
          if (this.y > ui.simulationCanvas.height) { this.y = ui.simulationCanvas.height; this.direction += Math.PI; }
          this.path.push({ x: this.x, y: this.y });
          if (this.path.length > config.pathHistoryLength) { this.path.shift(); }
      }

      interactWithTarget() {
          if (!this.target) return;
          if (this.target instanceof Manna) { this.energy += config.energy.fromManna * this.efficiency; this.target.energy = 0; this.target = null;
          } else if (this.target instanceof Organism) {
              this.energy -= config.energy.attackCost;
              const damageDealt = config.energy.predatorDamage * (1 - this.target.defense);
              this.target.energy -= damageDealt;
              if (this.target.energy <= 0) {
                  const energyGained = config.energy.fromKill * config.energy.predatorEfficiency * this.efficiency;
                  this.energy += energyGained; this.target = null;
              }
          }
      }

      reproduce() {
          const childEnergy = config.energy.reproduceCost;
          if (this.energy < childEnergy + 10) return; this.energy -= childEnergy;
          const newGenes = {
              speed: mutateGene(this.speed, config.genes.speed, config.mutation.rate, config.mutation.strength),
              aggression: mutateGene(this.aggression, config.genes.aggression, config.mutation.rate, config.mutation.strength),
              efficiency: mutateGene(this.efficiency, config.genes.efficiency, config.mutation.rate, config.mutation.strength),
              perception: mutateGene(this.perception, config.genes.perception, config.mutation.rate, config.mutation.strength),
              defense: mutateGene(this.defense, config.genes.defense, config.mutation.rate, config.mutation.strength),
          };
          const child = new Organism(this.x + (Math.random() - 0.5) * 20, this.y + (Math.random() - 0.5) * 20, this.species, newGenes);
          child.energy = childEnergy; organisms.push(child);
      }
  }

  class Manna { 
      constructor(x, y) { 
          this.x = x; 
          this.y = y; 
          this.energy = 1; 
          this.pulseOffset = Math.random() * Math.PI * 2;
      } 
      
      draw() { 
          const size = 3; 
          const pulse = Math.sin(frameCount * 0.08 + this.pulseOffset) * 0.3 + 1;
          
          ctx.save(); 
          ctx.translate(this.x, this.y); 
          
          // Glow effect
          const glowGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 3 * pulse);
          glowGradient.addColorStop(0, 'rgba(34, 197, 94, 0.4)');
          glowGradient.addColorStop(0.5, 'rgba(34, 197, 94, 0.2)');
          glowGradient.addColorStop(1, 'rgba(34, 197, 94, 0)');
          ctx.fillStyle = glowGradient;
          ctx.beginPath();
          ctx.arc(0, 0, size * 3 * pulse, 0, Math.PI * 2);
          ctx.fill();
          
          // Main manna diamond shape
          ctx.rotate(Math.PI / 4 + frameCount * 0.02); 
          
          const gradient = ctx.createLinearGradient(-size, -size, size, size);
          gradient.addColorStop(0, '#10b981');
          gradient.addColorStop(0.5, '#22c55e');
          gradient.addColorStop(1, '#34d399');
          
          ctx.fillStyle = gradient;
          ctx.shadowColor = '#22c55e';
          ctx.shadowBlur = 8;
          ctx.fillRect(-size * pulse, -size * pulse, size * 2 * pulse, size * 2 * pulse); 
          
          // Inner highlight
          ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.fillRect(-size * 0.5 * pulse, -size * 0.5 * pulse, size * pulse, size * pulse);
          
          ctx.restore(); 
      } 
  }

  
  function getZoneForOrganism(organism) { const centerX = ui.simulationCanvas.width / 2; const centerY = ui.simulationCanvas.height / 2; const orgAngle = Math.atan2(organism.y - centerY, organism.x - centerX); let relativeAngle = (orgAngle - environment.angle) % (2 * Math.PI); if (relativeAngle < 0) relativeAngle += 2 * Math.PI; return relativeAngle < Math.PI ? "dark" : "light"; }
  function drawEnvironment() { 
      const centerX = ui.simulationCanvas.width / 2; 
      const centerY = ui.simulationCanvas.height / 2; 
      const radius = Math.sqrt(centerX ** 2 + centerY ** 2); 
      
      ctx.save(); 
      
      // Dark zone with subtle gradient
      const darkGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
      darkGradient.addColorStop(0, '#2a2a2a');
      darkGradient.addColorStop(1, config.environment.darkColor);
      ctx.fillStyle = darkGradient;
      ctx.beginPath(); 
      ctx.moveTo(centerX, centerY); 
      ctx.arc(centerX, centerY, radius, environment.angle, environment.angle + Math.PI); 
      ctx.closePath(); 
      ctx.fill(); 
      
      // Light zone with subtle gradient
      const lightGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
      lightGradient.addColorStop(0, '#FFFFFF');
      lightGradient.addColorStop(1, '#f5f5f5');
      ctx.fillStyle = lightGradient;
      ctx.beginPath(); 
      ctx.moveTo(centerX, centerY); 
      ctx.arc(centerX, centerY, radius, environment.angle + Math.PI, environment.angle + 2 * Math.PI); 
      ctx.closePath(); 
      ctx.fill(); 
      
      // Boundary line with glow
      ctx.strokeStyle = 'rgba(100, 100, 100, 0.3)';
      ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(
          centerX + Math.cos(environment.angle) * radius,
          centerY + Math.sin(environment.angle) * radius
      );
      ctx.stroke();
      
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(
          centerX + Math.cos(environment.angle + Math.PI) * radius,
          centerY + Math.sin(environment.angle + Math.PI) * radius
      );
      ctx.stroke();
      
      ctx.restore(); 
  }
  
  function updateConfigFromUI() {
      config.initialAlphaPop = parseInt(ui.initialAlphaPop.value);
      config.initialBetaPop = parseInt(ui.initialBetaPop.value);
      config.initialManna = parseInt(ui.initialManna.value);
      config.maxManna = parseInt(ui.maxManna.value);
      config.mannaSpawnRate = parseFloat(ui.mannaSpawnRate.value);
      config.mutation.rate = parseFloat(ui.mutationRate.value);
      config.mutation.strength = parseFloat(ui.mutationStrength.value);
      config.overpopulation.threshold = parseInt(ui.overpopulationThreshold.value);
      config.overpopulation.penalty = parseFloat(ui.overpopulationPenalty.value);
      config.energy.initial = parseInt(ui.initialEnergy.value);
      config.energy.reproduceThreshold = parseInt(ui.reproduceThreshold.value);
      config.energy.reproduceCost = parseInt(ui.reproduceCost.value);
      config.energy.fromManna = parseInt(ui.mannaEnergy.value);
      config.energy.fromKill = parseInt(ui.killEnergy.value);
      config.energy.predatorDamage = parseInt(ui.attackDamage.value);
      config.energy.attackCost = parseInt(ui.attackCost.value);
      config.environment.homeTurfSpeedPenalty = parseFloat(ui.homeTurfSpeedPenalty.value);
      config.environment.homeTurfPerceptionPenalty = parseFloat(ui.homeTurfPerceptionPenalty.value);
      config.environment.homeTurfMetabolismPenalty = parseFloat(ui.homeTurfMetabolismPenalty.value);
      config.environment.enemyTurfMetabolismBenefit = parseFloat(ui.enemyTurfMetabolismBenefit.value);

      config.generationLengthInFrames = parseInt(ui.generationLength.value);
      config.organismSize = parseInt(ui.organismSize.value);
      config.pathHistoryLength = parseInt(ui.pathHistory.value);
      config.lowEnergyThreshold = parseInt(ui.lowEnergyThreshold.value);
      config.fleeEnergyThreshold = parseInt(ui.fleeEnergyThreshold.value);
      config.maxAge = parseInt(ui.maxAge.value);
      config.senescenceStartFactor = parseFloat(ui.senescenceStartFactor.value);
      config.patchGenerationInterval = parseInt(ui.patchGenerationInterval.value);
      config.numPatches = parseInt(ui.numPatches.value);
      config.patchRadius = parseInt(ui.patchRadius.value);
      config.patchDistributionStdDev = parseFloat(ui.patchDistributionStdDev.value);
      config.environment.rotationSpeed = parseFloat(ui.environmentRotationSpeed.value);
      config.environment.darkColor = ui.darkColor.value;
      config.environment.lightColor = ui.lightColor.value;
      config.environment.traceViewBg = ui.traceViewBg.value;
      config.genes.speed.min = parseFloat(ui.geneSpeedMin.value);
      config.genes.speed.max = parseFloat(ui.geneSpeedMax.value);
      config.genes.aggression.min = parseFloat(ui.geneAggressionMin.value);
      config.genes.aggression.max = parseFloat(ui.geneAggressionMax.value);
      config.genes.perception.min = parseFloat(ui.genePerceptionMin.value);
      config.genes.perception.max = parseFloat(ui.genePerceptionMax.value);
      config.genes.perception.cost = parseFloat(ui.genePerceptionCost.value);
      config.genes.defense.min = parseFloat(ui.geneDefenseMin.value);
      config.genes.defense.max = parseFloat(ui.geneDefenseMax.value);
      config.genes.defense.speedPenalty = parseFloat(ui.geneDefenseSpeedPenalty.value);
      config.genes.efficiency.min = parseFloat(ui.geneEfficiencyMin.value);
      config.genes.efficiency.max = parseFloat(ui.geneEfficiencyMax.value);
      config.overpopulation.stressRadius = parseInt(ui.overpopulationStressRadius.value);
      config.energy.predatorEfficiency = parseFloat(ui.predatorEfficiency.value);
      config.energy.metabolism = parseFloat(ui.metabolism.value);
  }

  function setUIFromConfig() {
      ui.initialAlphaPop.value = config.initialAlphaPop;
      ui.initialBetaPop.value = config.initialBetaPop;
      ui.initialManna.value = config.initialManna;
      ui.maxManna.value = config.maxManna;
      ui.mannaSpawnRate.value = config.mannaSpawnRate;
      ui.mutationRate.value = config.mutation.rate;
      ui.mutationStrength.value = config.mutation.strength;
      ui.overpopulationThreshold.value = config.overpopulation.threshold;
      ui.overpopulationPenalty.value = config.overpopulation.penalty;
      ui.initialEnergy.value = config.energy.initial;
      ui.reproduceThreshold.value = config.energy.reproduceThreshold;
      ui.reproduceCost.value = config.energy.reproduceCost;
      ui.mannaEnergy.value = config.energy.fromManna;
      ui.killEnergy.value = config.energy.fromKill;
      ui.attackDamage.value = config.energy.predatorDamage;
      ui.attackCost.value = config.energy.attackCost;
      ui.homeTurfSpeedPenalty.value = config.environment.homeTurfSpeedPenalty;
      ui.homeTurfPerceptionPenalty.value = config.environment.homeTurfPerceptionPenalty;
      ui.homeTurfMetabolismPenalty.value = config.environment.homeTurfMetabolismPenalty;
      ui.enemyTurfMetabolismBenefit.value = config.environment.enemyTurfMetabolismBenefit;

      ui.generationLength.value = config.generationLengthInFrames;
      ui.organismSize.value = config.organismSize;
      ui.pathHistory.value = config.pathHistoryLength;
      ui.lowEnergyThreshold.value = config.lowEnergyThreshold;
      ui.fleeEnergyThreshold.value = config.fleeEnergyThreshold;
      ui.maxAge.value = config.maxAge;
      ui.senescenceStartFactor.value = config.senescenceStartFactor;
      ui.patchGenerationInterval.value = config.patchGenerationInterval;
      ui.numPatches.value = config.numPatches;
      ui.patchRadius.value = config.patchRadius;
      ui.patchDistributionStdDev.value = config.patchDistributionStdDev;
      ui.environmentRotationSpeed.value = config.environment.rotationSpeed;
      ui.darkColor.value = config.environment.darkColor;
      ui.lightColor.value = config.environment.lightColor;
      ui.traceViewBg.value = config.environment.traceViewBg;
      ui.geneSpeedMin.value = config.genes.speed.min;
      ui.geneSpeedMax.value = config.genes.speed.max;
      ui.geneAggressionMin.value = config.genes.aggression.min;
      ui.geneAggressionMax.value = config.genes.aggression.max;
      ui.genePerceptionMin.value = config.genes.perception.min;
      ui.genePerceptionMax.value = config.genes.perception.max;
      ui.genePerceptionCost.value = config.genes.perception.cost;
      ui.geneDefenseMin.value = config.genes.defense.min;
      ui.geneDefenseMax.value = config.genes.defense.max;
      ui.geneDefenseSpeedPenalty.value = config.genes.defense.speedPenalty;
      ui.geneEfficiencyMin.value = config.genes.efficiency.min;
      ui.geneEfficiencyMax.value = config.genes.efficiency.max;
      ui.overpopulationStressRadius.value = config.overpopulation.stressRadius;
      ui.predatorEfficiency.value = config.energy.predatorEfficiency;
      ui.metabolism.value = config.energy.metabolism;
  }
  
  function spawnManna() {
      if (manna.length >= config.maxManna || fertilePatches.length === 0) return;
      const patch = fertilePatches[Math.floor(Math.random() * fertilePatches.length)];
      const angle = Math.random() * 2 * Math.PI; const radius = Math.random() * patch.radius;
      const x = patch.x + Math.cos(angle) * radius; const y = patch.y + Math.sin(angle) * radius;
      const boundedX = Math.max(0, Math.min(ui.simulationCanvas.width, x));
      const boundedY = Math.max(0, Math.min(ui.simulationCanvas.height, y));
      manna.push(new Manna(boundedX, boundedY));
  }

  function generateNewPatches() {
      fertilePatches = [];
      const centerX = ui.simulationCanvas.width / 2; const centerY = ui.simulationCanvas.height / 2;
      const stdDev = ui.simulationCanvas.width * config.patchDistributionStdDev;
      for (let i = 0; i < config.numPatches; i++) {
          fertilePatches.push({ x: randomGaussian(centerX, stdDev), y: randomGaussian(centerY, stdDev), radius: config.patchRadius });
      }
  }

  function init() {
      updateConfigFromUI();
      ui.simulationCanvas.width = window.innerWidth;
      ui.simulationCanvas.height = window.innerHeight;
      const boundary = new Rectangle(ui.simulationCanvas.width / 2, ui.simulationCanvas.height / 2, ui.simulationCanvas.width / 2, ui.simulationCanvas.height / 2);
      quadtree = new Quadtree(boundary, 4);
      organisms = []; manna = [];
      generation = 1; nextOrgId = 0; frameCount = 0;
      environment.angle = 0; isTraceView = false;
      ui.traceViewBtn.textContent = "Show Traces";
      generateNewPatches();
      for (let i = 0; i < config.initialAlphaPop; i++) organisms.push(new Organism(Math.random() * ui.simulationCanvas.width, Math.random() * ui.simulationCanvas.height, "alpha"));
      for (let i = 0; i < config.initialBetaPop; i++) organisms.push(new Organism(Math.random() * ui.simulationCanvas.width, Math.random() * ui.simulationCanvas.height, "beta"));
      for (let i = 0; i < config.initialManna; i++) spawnManna();
      updateUI();
  }

  function gameLoop() {
      if (isRunning) {
          for (let i = 0; i < gameSpeed; i++) {
              frameCount++;
              if (frameCount % config.generationLengthInFrames === 0 && frameCount > 0) generation++;
              if (frameCount % config.patchGenerationInterval === 0) generateNewPatches();
              environment.angle = (environment.angle + config.environment.rotationSpeed) % (2 * Math.PI);
              if (Math.random() < config.mannaSpawnRate) spawnManna();
              quadtree.clear();
              organisms.forEach((org) => quadtree.insert(org));
              manna.forEach((m) => quadtree.insert(m));
              organisms.forEach((org) => org.update(quadtree));
              const survivingOrganisms = [];
              for (const org of organisms) { if (org.energy > 0) survivingOrganisms.push(org); }
              organisms = survivingOrganisms;
              const remainingManna = [];
              for (const m of manna) { if (m.energy > 0) remainingManna.push(m); }
              manna = remainingManna;
          }
          if (isTraceView) {
              // Trace view with gradient background
              const traceGradient = ctx.createRadialGradient(
                  ui.simulationCanvas.width / 2, 
                  ui.simulationCanvas.height / 2, 
                  0,
                  ui.simulationCanvas.width / 2, 
                  ui.simulationCanvas.height / 2, 
                  Math.max(ui.simulationCanvas.width, ui.simulationCanvas.height) / 2
              );
              traceGradient.addColorStop(0, '#006666');
              traceGradient.addColorStop(1, config.environment.traceViewBg);
              ctx.fillStyle = traceGradient;
              ctx.fillRect(0, 0, ui.simulationCanvas.width, ui.simulationCanvas.height);
              organisms.forEach((org) => org.drawTrace());
              
              // Draw current organism positions as dots
              organisms.forEach((org) => {
                  ctx.fillStyle = org.species === "alpha" ? 
                      'rgba(26, 26, 26, 0.9)' : 
                      'rgba(255, 255, 255, 0.9)';
                  ctx.beginPath();
                  ctx.arc(org.x, org.y, config.organismSize * 0.5, 0, Math.PI * 2);
                  ctx.fill();
              });
          } else {
              ctx.clearRect(0, 0, ui.simulationCanvas.width, ui.simulationCanvas.height);
              drawEnvironment();
              
              // Enhanced fertile patches with gradient and animation
              ctx.save(); 
              fertilePatches.forEach((p, index) => { 
                  const pulsePhase = (frameCount * 0.01 + index * 0.3) % (Math.PI * 2);
                  const pulse = Math.sin(pulsePhase) * 0.1 + 0.9;
                  
                  const patchGradient = ctx.createRadialGradient(
                      p.x, p.y, 0,
                      p.x, p.y, p.radius * pulse
                  );
                  patchGradient.addColorStop(0, 'rgba(34, 197, 94, 0.15)');
                  patchGradient.addColorStop(0.7, 'rgba(34, 197, 94, 0.08)');
                  patchGradient.addColorStop(1, 'rgba(34, 197, 94, 0)');
                  
                  ctx.fillStyle = patchGradient;
                  ctx.beginPath(); 
                  ctx.arc(p.x, p.y, p.radius * pulse, 0, 2 * Math.PI); 
                  ctx.fill(); 
                  
                  // Patch outline
                  ctx.strokeStyle = 'rgba(34, 197, 94, 0.2)';
                  ctx.lineWidth = 1;
                  ctx.stroke();
              });
              ctx.restore();
              
              manna.forEach((m) => m.draw());
              organisms.forEach((org) => org.draw());
          }
          if (frameCount % 15 === 0) updateUI();
      }
      requestAnimationFrame(gameLoop);
  }

  function updateUI() {
      let alphaPop = 0, betaPop = 0;
      const avgGenes = { alpha: { speed: 0, aggression: 0, efficiency: 0, perception: 0, defense: 0, }, beta: { speed: 0, aggression: 0, efficiency: 0, perception: 0, defense: 0, }, };
      organisms.forEach((org) => { const species = org.species; if (species === "alpha") alphaPop++; else betaPop++; for (const gene in avgGenes[species]) avgGenes[species][gene] += org[gene]; });
      if (alphaPop > 0) Object.keys(avgGenes.alpha).forEach((k) => (avgGenes.alpha[k] /= alphaPop));
      if (betaPop > 0) Object.keys(avgGenes.beta).forEach((k) => (avgGenes.beta[k] /= betaPop));
      
      // Track population trends
      populationHistory.alpha.push(alphaPop);
      populationHistory.beta.push(betaPop);
      if (populationHistory.alpha.length > populationHistory.maxHistory) {
          populationHistory.alpha.shift();
          populationHistory.beta.shift();
      }
      
      ui.generationStat.textContent = generation; ui.populationStat.textContent = organisms.length;
      ui.alphaPopStat.textContent = alphaPop; ui.betaPopStat.textContent = betaPop;
      ui.alphaSpeedStat.textContent = avgGenes.alpha.speed.toFixed(2); ui.betaSpeedStat.textContent = avgGenes.beta.speed.toFixed(2);
      ui.alphaAggressionStat.textContent = avgGenes.alpha.aggression.toFixed(2); ui.betaAggressionStat.textContent = avgGenes.beta.aggression.toFixed(2);
      ui.alphaPerceptionStat.textContent = avgGenes.alpha.perception.toFixed(2); ui.betaPerceptionStat.textContent = avgGenes.beta.perception.toFixed(2);
      ui.alphaDefenseStat.textContent = avgGenes.alpha.defense.toFixed(2); ui.betaDefenseStat.textContent = avgGenes.beta.defense.toFixed(2);
      ui.alphaEfficiencyStat.textContent = avgGenes.alpha.efficiency.toFixed(2); ui.betaEfficiencyStat.textContent = avgGenes.beta.efficiency.toFixed(2);
      ui.alphaSpeedBar.style.height = `${getPercent(avgGenes.alpha.speed, config.genes.speed.min, config.genes.speed.max)}%`;
      ui.betaSpeedBar.style.height = `${getPercent(avgGenes.beta.speed, config.genes.speed.min, config.genes.speed.max)}%`;
      ui.alphaAggressionBar.style.height = `${getPercent(avgGenes.alpha.aggression, config.genes.aggression.min, config.genes.aggression.max)}%`;
      ui.betaAggressionBar.style.height = `${getPercent(avgGenes.beta.aggression, config.genes.aggression.min, config.genes.aggression.max)}%`;
      ui.alphaPerceptionBar.style.height = `${getPercent(avgGenes.alpha.perception, config.genes.perception.min, config.genes.perception.max)}%`;
      ui.betaPerceptionBar.style.height = `${getPercent(avgGenes.beta.perception, config.genes.perception.min, config.genes.perception.max)}%`;
      ui.alphaDefenseBar.style.height = `${getPercent(avgGenes.alpha.defense, config.genes.defense.min, config.genes.defense.max)}%`;
      ui.betaDefenseBar.style.height = `${getPercent(avgGenes.beta.defense, config.genes.defense.min, config.genes.defense.max)}%`;
      ui.alphaEfficiencyBar.style.height = `${getPercent(avgGenes.alpha.efficiency, config.genes.efficiency.min, config.genes.efficiency.max)}%`;
      ui.betaEfficiencyBar.style.height = `${getPercent(avgGenes.beta.efficiency, config.genes.efficiency.min, config.genes.efficiency.max)}%`;
  }

  
  // Update status badge
  function updateStatusBadge() {
      if (isRunning) {
          ui.statusText.textContent = `Running (${gameSpeed}x)`;
          ui.statusBadge.classList.remove('paused');
      } else {
          ui.statusText.textContent = 'Paused';
          ui.statusBadge.classList.add('paused');
      }
  }
  
  // Play/Pause toggle
  function togglePlayPause() {
      isRunning = !isRunning;
      ui.playPauseBtn.textContent = isRunning ? "Pause" : "Play";
      updateStatusBadge();
  }
  
  // Trace view toggle
  function toggleTraceView() {
      isTraceView = !isTraceView;
      ui.traceViewBtn.textContent = isTraceView ? "Show Organisms" : "Show Traces";
  }
  
  // Speed adjustment
  function adjustSpeed(delta) {
      gameSpeed = Math.max(0.25, Math.min(100, gameSpeed + delta));
      ui.speedSlider.value = gameSpeed;
      ui.speedValue.textContent = `${gameSpeed}x`;
      if (isRunning) updateStatusBadge();
  }
  
  // Reset with loading state
  function resetSimulation() {
      ui.resetBtn.classList.add('loading');
      ui.resetBtn.textContent = 'Restarting...';
      ui.resetBtn.disabled = true;
      
      setTimeout(() => {
          init();
          ui.resetBtn.classList.remove('loading');
          ui.resetBtn.textContent = 'Apply & Restart';
          ui.resetBtn.disabled = false;
      }, 100);
  }
  
  // Event listeners
  ui.playPauseBtn.addEventListener("click", togglePlayPause);
  ui.resetBtn.addEventListener("click", resetSimulation);
  ui.speedSlider.addEventListener("input", (e) => { 
      gameSpeed = parseFloat(e.target.value); 
      ui.speedValue.textContent = `${gameSpeed}x`; 
      if (isRunning) updateStatusBadge();
  });
  ui.traceViewBtn.addEventListener("click", toggleTraceView);
  
  const resizeCanvas = () => { 
      ui.simulationCanvas.width = window.innerWidth; 
      ui.simulationCanvas.height = window.innerHeight; 
  };
  
  const resizeAndInit = () => { 
      resizeCanvas();
      init(); 
  };
  
  ui.sidebarToggle.addEventListener("click", () => { 
      ui.sidebar.classList.toggle("collapsed");
  });
  
  window.addEventListener("resize", resizeAndInit);
  
  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
      // Ignore if typing in input fields
      if (e.target.tagName === 'INPUT') return;
      
      switch(e.key.toLowerCase()) {
          case ' ':
              e.preventDefault();
              togglePlayPause();
              break;
          case 't':
              e.preventDefault();
              toggleTraceView();
              break;
          case 'r':
              e.preventDefault();
              resetSimulation();
              break;
          case '[':
              e.preventDefault();
              adjustSpeed(-0.25);
              break;
          case ']':
              e.preventDefault();
              adjustSpeed(0.25);
              break;
      }
  });

  
  setUIFromConfig();
  init();
  gameLoop();
});