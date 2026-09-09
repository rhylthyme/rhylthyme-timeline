// Generated from test/fixtures/programs by: node -e (see examples/README note)
window.RHYLTHYME_EXAMPLES = {
 "thanksgiving_one_oven": {
  "schemaVersion": "0.2.0-alpha",
  "programId": "thanksgiving-one-oven",
  "name": "Thanksgiving with One Oven",
  "description": "Turkey, stuffing, mashed potatoes, gravy and a green salad, coordinated around a single oven so that everything reaches the table together.",
  "environmentType": "kitchen",
  "actors": 2,
  "tracks": [
   {
    "trackId": "turkey",
    "name": "Turkey",
    "steps": [
     {
      "stepId": "turkey-prep",
      "name": "Season and truss",
      "task": "prep",
      "duration": {
       "type": "fixed",
       "seconds": 1200
      },
      "startTrigger": {
       "type": "programStart"
      }
     },
     {
      "stepId": "turkey-roast",
      "name": "Roast until 74°C",
      "task": "oven",
      "duration": {
       "type": "indefinite",
       "defaultSeconds": 9900
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "turkey-prep"
      }
     },
     {
      "stepId": "turkey-rest",
      "name": "Rest",
      "task": "counter",
      "duration": {
       "type": "fixed",
       "seconds": 1800
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "turkey-roast"
      }
     },
     {
      "stepId": "turkey-carve",
      "name": "Carve and serve",
      "task": "prep",
      "duration": {
       "type": "fixed",
       "seconds": 600
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "guests-seated"
      }
     }
    ]
   },
   {
    "trackId": "stuffing",
    "name": "Stuffing",
    "steps": [
     {
      "stepId": "stuffing-prep",
      "name": "Sauté aromatics, mix",
      "task": "stove",
      "duration": {
       "type": "fixed",
       "seconds": 1500
      },
      "startTrigger": {
       "type": "programStartOffset",
       "offsetSeconds": 5400
      }
     },
     {
      "stepId": "stuffing-bake",
      "name": "Bake stuffing",
      "task": "oven",
      "duration": {
       "type": "fixed",
       "seconds": 2100
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "turkey-roast"
      }
     }
    ]
   },
   {
    "trackId": "potatoes",
    "name": "Potatoes",
    "steps": [
     {
      "stepId": "potatoes-peel",
      "name": "Peel and cut",
      "task": "prep",
      "duration": {
       "type": "fixed",
       "seconds": 900
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "turkey-roast",
       "offsetSeconds": -2700
      }
     },
     {
      "stepId": "potatoes-boil",
      "name": "Boil until tender",
      "task": "stove",
      "duration": {
       "type": "variable",
       "minSeconds": 900,
       "maxSeconds": 1500,
       "defaultSeconds": 1200
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "potatoes-peel"
      }
     },
     {
      "stepId": "potatoes-mash",
      "name": "Mash with butter",
      "task": "prep",
      "duration": {
       "type": "fixed",
       "seconds": 600
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "potatoes-boil"
      }
     }
    ]
   },
   {
    "trackId": "gravy",
    "name": "Gravy",
    "steps": [
     {
      "stepId": "gravy-make",
      "name": "Make gravy from drippings",
      "task": "stove",
      "duration": {
       "type": "fixed",
       "seconds": 900
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "turkey-roast",
       "offsetSeconds": 300
      }
     }
    ]
   },
   {
    "trackId": "service",
    "name": "Service",
    "steps": [
     {
      "stepId": "salad",
      "name": "Dress the salad",
      "task": "prep",
      "duration": {
       "type": "fixed",
       "seconds": 300
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "stuffing-bake",
       "event": "start",
       "offsetSeconds": 1500
      }
     },
     {
      "stepId": "guests-seated",
      "name": "Guests seated",
      "task": "host",
      "duration": {
       "type": "fixed",
       "seconds": 300
      },
      "startTrigger": {
       "type": "manual",
       "triggerName": "guests-seated"
      }
     },
     {
      "stepId": "serve",
      "name": "Serve",
      "task": "host",
      "duration": {
       "type": "fixed",
       "seconds": 300
      },
      "startTrigger": {
       "logic": "all",
       "triggers": [
        {
         "type": "afterStep",
         "stepId": "turkey-carve"
        },
        {
         "type": "afterStep",
         "stepId": "stuffing-bake"
        },
        {
         "type": "afterStep",
         "stepId": "potatoes-mash"
        },
        {
         "type": "afterStep",
         "stepId": "gravy-make"
        }
       ]
      }
     }
    ]
   }
  ],
  "resourceConstraints": [
   {
    "task": "oven",
    "maxConcurrent": 1,
    "description": "One oven"
   },
   {
    "task": "stove",
    "maxConcurrent": 4,
    "description": "Four burners"
   },
   {
    "task": "prep",
    "maxConcurrent": 2,
    "description": "Counter space for two"
   },
   {
    "task": "counter",
    "maxConcurrent": 1,
    "description": "Resting board"
   },
   {
    "task": "host",
    "maxConcurrent": 1,
    "description": "Whoever is hosting"
   }
  ],
  "metadata": {
   "serves": "8"
  }
 },
 "breakfast_schedule": {
  "schemaVersion": "0.1.0",
  "programId": "breakfast-schedule",
  "name": "Breakfast Schedule",
  "description": "Coordinated breakfast preparation schedule for scrambled eggs, bacon, and toast",
  "environmentType": "kitchen",
  "startTrigger": {
   "type": "offset",
   "offsetSeconds": 1
  },
  "tracks": [
   {
    "trackId": "scrambled-eggs",
    "name": "Scrambled Eggs",
    "steps": [
     {
      "stepId": "eggs-crack-whisk",
      "name": "Crack and Whisk Eggs",
      "description": "Crack eggs into a bowl and whisk with salt and pepper",
      "startTrigger": {
       "type": "programStart"
      },
      "duration": {
       "type": "fixed",
       "seconds": 60
      },
      "task": "prep-work"
     },
     {
      "stepId": "eggs-heat-pan",
      "name": "Heat Pan",
      "description": "Place pan on stove and heat to medium",
      "startTrigger": {
       "type": "afterStep",
       "stepId": "eggs-crack-whisk"
      },
      "duration": {
       "type": "variable",
       "minSeconds": 60,
       "maxSeconds": 120,
       "defaultSeconds": 90,
       "triggerName": "pan-ready"
      },
      "task": "stove-burner"
     },
     {
      "stepId": "eggs-cook",
      "name": "Cook Eggs",
      "description": "Pour eggs into pan and cook until done",
      "startTrigger": {
       "type": "afterStep",
       "stepId": "eggs-heat-pan"
      },
      "duration": {
       "type": "variable",
       "minSeconds": 120,
       "maxSeconds": 180,
       "defaultSeconds": 150,
       "triggerName": "eggs-done"
      },
      "task": "stove-burner"
     }
    ]
   },
   {
    "trackId": "bacon",
    "name": "Bacon",
    "steps": [
     {
      "stepId": "bacon-prep",
      "name": "Prepare Bacon",
      "description": "Place bacon strips in cold pan",
      "startTrigger": {
       "type": "programStart"
      },
      "duration": {
       "type": "fixed",
       "seconds": 60
      },
      "task": "prep-work"
     },
     {
      "stepId": "bacon-cook",
      "name": "Cook Bacon",
      "description": "Cook bacon, flipping occasionally until crispy",
      "startTrigger": {
       "type": "afterStep",
       "stepId": "bacon-prep"
      },
      "duration": {
       "type": "variable",
       "minSeconds": 480,
       "maxSeconds": 720,
       "defaultSeconds": 600,
       "triggerName": "bacon-done"
      },
      "task": "stove-burner"
     }
    ]
   },
   {
    "trackId": "toast",
    "name": "Toast",
    "steps": [
     {
      "stepId": "toast-cook",
      "name": "Make Toast",
      "description": "Place bread in toaster and toast until golden brown",
      "startTrigger": {
       "type": "programStartOffset",
       "offsetSeconds": 480
      },
      "duration": {
       "type": "fixed",
       "seconds": 210
      },
      "task": "toaster"
     }
    ]
   }
  ],
  "resourceConstraints": [
   {
    "task": "stove-burner",
    "maxConcurrent": 2,
    "description": "Maximum number of stove burners that can be used simultaneously"
   },
   {
    "task": "prep-work",
    "maxConcurrent": 2,
    "description": "General preparation work"
   },
   {
    "task": "toaster",
    "maxConcurrent": 1,
    "description": "Toaster usage"
   }
  ],
  "actors": 2,
  "version": "1.0.0"
 },
 "stir_fry_with_choice": {
  "schemaVersion": "0.1.0-alpha",
  "programId": "stir-fry-with-choice",
  "name": "Stir Fry with Protein Choice",
  "description": "A veggie stir fry where you choose your protein — chicken, tofu, or shrimp",
  "environmentType": "kitchen",
  "actors": 1,
  "resourceConstraints": [
   {
    "task": "stovetop",
    "maxConcurrent": 2,
    "description": "Stovetop burners"
   },
   {
    "task": "prep",
    "maxConcurrent": 1,
    "description": "Cutting board / prep area"
   }
  ],
  "tracks": [
   {
    "trackId": "rice",
    "name": "Rice",
    "steps": [
     {
      "stepId": "rinse-rice",
      "name": "Rinse Rice",
      "task": "prep",
      "description": "Rinse jasmine rice until water runs clear",
      "duration": {
       "type": "fixed",
       "seconds": 120
      },
      "startTrigger": {
       "type": "programStart"
      }
     },
     {
      "stepId": "cook-rice",
      "name": "Cook Rice",
      "task": "stovetop",
      "description": "Bring to boil, then simmer covered for 15 minutes",
      "duration": {
       "type": "fixed",
       "seconds": 1080
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "rinse-rice"
      }
     }
    ]
   },
   {
    "trackId": "veggies",
    "name": "Vegetables",
    "steps": [
     {
      "stepId": "prep-veggies",
      "name": "Chop Vegetables",
      "task": "prep",
      "description": "Dice bell peppers, slice mushrooms, chop broccoli, mince garlic and ginger",
      "duration": {
       "type": "fixed",
       "seconds": 600
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "rinse-rice"
      }
     },
     {
      "stepId": "stir-fry-veggies",
      "name": "Stir Fry Vegetables",
      "task": "stovetop",
      "description": "High heat wok — cook veggies until crisp-tender, 4 minutes",
      "duration": {
       "type": "fixed",
       "seconds": 240
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "cook-protein"
      }
     }
    ]
   },
   {
    "trackId": "protein",
    "name": "Protein",
    "steps": [
     {
      "stepId": "choose-protein",
      "name": "Choose Your Protein",
      "task": "prep",
      "description": "Pick which protein to use for the stir fry",
      "duration": {
       "type": "fixed",
       "seconds": 30
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "prep-veggies"
      },
      "choice": {
       "prompt": "Which protein would you like?",
       "options": [
        {
         "choiceId": "chicken",
         "label": "Chicken"
        },
        {
         "choiceId": "tofu",
         "label": "Tofu"
        },
        {
         "choiceId": "shrimp",
         "label": "Shrimp"
        }
       ]
      }
     },
     {
      "stepId": "prep-chicken",
      "name": "Slice Chicken",
      "task": "prep",
      "description": "Slice chicken breast into thin strips, season with soy sauce and cornstarch",
      "duration": {
       "type": "fixed",
       "seconds": 300
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "choose-protein",
       "choiceId": "chicken"
      }
     },
     {
      "stepId": "prep-tofu",
      "name": "Press & Cube Tofu",
      "task": "prep",
      "description": "Press extra-firm tofu, cut into cubes, toss with cornstarch",
      "duration": {
       "type": "fixed",
       "seconds": 420
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "choose-protein",
       "choiceId": "tofu"
      }
     },
     {
      "stepId": "prep-shrimp",
      "name": "Peel & Devein Shrimp",
      "task": "prep",
      "description": "Peel, devein, and pat dry the shrimp",
      "duration": {
       "type": "fixed",
       "seconds": 360
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "choose-protein",
       "choiceId": "shrimp"
      }
     },
     {
      "stepId": "cook-protein",
      "name": "Cook Protein",
      "task": "stovetop",
      "description": "Sear the chosen protein in hot wok until golden and cooked through",
      "duration": {
       "type": "fixed",
       "seconds": 300
      },
      "startTrigger": {
       "logic": "any",
       "triggers": [
        {
         "type": "afterStep",
         "stepId": "prep-chicken"
        },
        {
         "type": "afterStep",
         "stepId": "prep-tofu"
        },
        {
         "type": "afterStep",
         "stepId": "prep-shrimp"
        }
       ]
      }
     }
    ]
   },
   {
    "trackId": "sauce",
    "name": "Sauce",
    "steps": [
     {
      "stepId": "make-sauce",
      "name": "Mix Stir Fry Sauce",
      "task": "prep",
      "description": "Whisk together soy sauce, oyster sauce, sesame oil, rice vinegar, and a touch of brown sugar",
      "duration": {
       "type": "fixed",
       "seconds": 120
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "prep-veggies"
      }
     },
     {
      "stepId": "add-sauce",
      "name": "Add Sauce & Toss",
      "task": "stovetop",
      "description": "Pour sauce over veggies, toss everything together, cook 1 minute until glossy",
      "duration": {
       "type": "fixed",
       "seconds": 60
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "stir-fry-veggies"
      }
     }
    ]
   }
  ],
  "metadata": {
   "ingredients": [
    {
     "name": "jasmine rice",
     "measure": "1.5 cups"
    },
    {
     "name": "bell peppers",
     "measure": "2, diced"
    },
    {
     "name": "mushrooms",
     "measure": "8 oz, sliced"
    },
    {
     "name": "broccoli",
     "measure": "2 cups, chopped"
    },
    {
     "name": "garlic",
     "measure": "4 cloves, minced"
    },
    {
     "name": "ginger",
     "measure": "1 inch, minced"
    },
    {
     "name": "chicken breast OR extra-firm tofu OR shrimp",
     "measure": "1 lb"
    },
    {
     "name": "soy sauce",
     "measure": "3 tbsp"
    },
    {
     "name": "oyster sauce",
     "measure": "2 tbsp"
    },
    {
     "name": "sesame oil",
     "measure": "1 tbsp"
    },
    {
     "name": "rice vinegar",
     "measure": "1 tbsp"
    },
    {
     "name": "brown sugar",
     "measure": "1 tsp"
    },
    {
     "name": "cornstarch",
     "measure": "1 tbsp"
    }
   ],
   "serves": "Serves 4"
  }
 },
 "lab_experiment": {
  "schemaVersion": "0.1.0",
  "programId": "lab-experiment",
  "name": "Basic Laboratory Experiment",
  "description": "Simple laboratory experiment workflow for protein analysis",
  "version": "1.0.0",
  "environmentType": "laboratory",
  "defaultEnvironment": "basic-research-lab",
  "startTrigger": {
   "type": "manual"
  },
  "meta": {
   "reagents": [
    {
     "name": "DNA Extraction Kit",
     "catalog": "Qiagen 69504",
     "storage": "-20C"
    },
    {
     "name": "Taq DNA Polymerase",
     "catalog": "NEB M0273",
     "storage": "-20C"
    },
    {
     "name": "dNTP Mix (10mM each)",
     "catalog": "NEB N0447",
     "storage": "-20C"
    },
    {
     "name": "PCR Primers (forward + reverse)",
     "storage": "-20C"
    },
    {
     "name": "Agarose",
     "catalog": "Bio-Rad 1613100",
     "storage": "RT"
    },
    {
     "name": "TAE Buffer (1X)",
     "storage": "RT"
    },
    {
     "name": "Ethidium Bromide",
     "catalog": "Sigma E1510",
     "storage": "RT",
     "hazard": "mutagen"
    },
    {
     "name": "DNA Ladder (100bp)",
     "catalog": "NEB N3231",
     "storage": "-20C"
    }
   ],
   "safetyNotes": [
    "Wear gloves when handling ethidium bromide",
    "Use UV-protective eyewear for gel imaging"
   ],
   "sampleType": "tissue",
   "outputFormat": "gel image"
  },
  "tracks": [
   {
    "trackId": "sample-prep",
    "name": "Sample Preparation",
    "steps": [
     {
      "stepId": "extract-dna",
      "name": "Extract DNA",
      "description": "Extract DNA from tissue samples",
      "startTrigger": {
       "type": "programStart"
      },
      "duration": {
       "type": "fixed",
       "seconds": 1800
      },
      "task": "bench-space",
      "preBuffer": {
       "duration": "5m",
       "description": "Gather samples and reagents",
       "tasks": [
        "prep-work"
       ]
      },
      "postBuffer": {
       "duration": "10m",
       "description": "Store extracted DNA",
       "tasks": [
        "freezer-80"
       ]
      }
     },
     {
      "stepId": "quantify-dna",
      "name": "Quantify DNA",
      "description": "Measure DNA concentration using spectrophotometer",
      "startTrigger": {
       "type": "afterStep",
       "stepId": "extract-dna"
      },
      "duration": {
       "type": "fixed",
       "seconds": 600
      },
      "task": "spectrophotometer"
     }
    ]
   },
   {
    "trackId": "pcr-amplification",
    "name": "PCR Amplification",
    "steps": [
     {
      "stepId": "prepare-pcr-mix",
      "name": "Prepare PCR Mix",
      "description": "Prepare master mix and distribute to tubes",
      "startTrigger": {
       "type": "afterStep",
       "stepId": "quantify-dna"
      },
      "duration": {
       "type": "fixed",
       "seconds": 900
      },
      "task": "bench-space",
      "preBuffer": {
       "duration": "5m",
       "description": "Thaw reagents",
       "tasks": [
        "prep-work"
       ]
      }
     },
     {
      "stepId": "run-pcr",
      "name": "Run PCR",
      "description": "Thermal cycling for DNA amplification",
      "startTrigger": {
       "type": "afterStep",
       "stepId": "prepare-pcr-mix"
      },
      "duration": {
       "type": "fixed",
       "seconds": 7200
      },
      "task": "pcr-machine"
     },
     {
      "stepId": "analyze-products",
      "name": "Analyze PCR Products",
      "description": "Run gel electrophoresis to verify amplification",
      "startTrigger": {
       "type": "afterStep",
       "stepId": "run-pcr"
      },
      "duration": {
       "type": "fixed",
       "seconds": 2400
      },
      "task": "bench-space",
      "postBuffer": {
       "duration": "15m",
       "description": "Document results and cleanup",
       "tasks": [
        "data-analysis",
        "cleanup"
       ]
      }
     }
    ]
   }
  ],
  "resourceConstraints": [
   {
    "task": "bench-space",
    "maxConcurrent": 4,
    "description": "General bench space usage"
   },
   {
    "task": "prep-work",
    "maxConcurrent": 2,
    "description": "Preparation work"
   },
   {
    "task": "freezer-80",
    "maxConcurrent": 2,
    "description": "-80°C freezer access"
   },
   {
    "task": "spectrophotometer",
    "maxConcurrent": 1,
    "description": "Spectrophotometer usage"
   },
   {
    "task": "pcr-machine",
    "maxConcurrent": 2,
    "description": "PCR machine usage"
   },
   {
    "task": "data-analysis",
    "maxConcurrent": 3,
    "description": "Data analysis work"
   },
   {
    "task": "cleanup",
    "maxConcurrent": 2,
    "description": "Cleanup operations"
   }
  ]
 },
 "negative_offset_demo": {
  "schemaVersion": "0.1.0",
  "programId": "negative-offset-demo",
  "name": "Negative Offset Demo",
  "description": "Demonstrates negative offsetSeconds: Step B runs indefinitely until Step A is started, which caps Step B at 20 minutes remaining. A secondary example shows a prep step that starts 5 minutes before the main cooking step finishes.",
  "environmentType": "kitchen",
  "tracks": [
   {
    "trackId": "main-cooking",
    "name": "Main Cooking",
    "description": "A slow-cooking step that runs indefinitely until the finishing step is started",
    "steps": [
     {
      "stepId": "prep-ingredients",
      "name": "Prep Ingredients",
      "description": "Chop vegetables, measure spices, and prepare all ingredients",
      "task": "prep-work",
      "duration": {
       "type": "fixed",
       "seconds": 600
      },
      "startTrigger": {
       "type": "programStart"
      }
     },
     {
      "stepId": "slow-braise",
      "name": "Slow Braise",
      "description": "Braise the meat low and slow — run indefinitely until the finishing sauce step is started, which will cap the remaining time at 20 minutes",
      "task": "stovetop",
      "duration": {
       "type": "indefinite",
       "defaultSeconds": 3600
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "prep-ingredients"
      }
     },
     {
      "stepId": "rest-and-serve",
      "name": "Rest and Serve",
      "description": "Let the meat rest, then plate and serve",
      "task": "prep-work",
      "duration": {
       "type": "fixed",
       "seconds": 600
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "slow-braise"
      }
     }
    ]
   },
   {
    "trackId": "finishing",
    "name": "Finishing Sauce",
    "description": "The finishing sauce that, when started, caps the braise at 20 more minutes",
    "steps": [
     {
      "stepId": "make-finishing-sauce",
      "name": "Make Finishing Sauce",
      "description": "Starting this step signals that the braise has 20 minutes left. Prepare the reduction sauce during that time.",
      "task": "stovetop",
      "duration": {
       "type": "fixed",
       "seconds": 1200
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "slow-braise",
       "offsetSeconds": -1200
      }
     },
     {
      "stepId": "combine-and-glaze",
      "name": "Combine and Glaze",
      "description": "Combine the sauce with the braised meat and glaze under the broiler",
      "task": "oven",
      "duration": {
       "type": "fixed",
       "seconds": 300
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "make-finishing-sauce"
      }
     }
    ]
   },
   {
    "trackId": "sides",
    "name": "Side Dishes",
    "description": "Prepare side dishes in parallel",
    "steps": [
     {
      "stepId": "cook-rice",
      "name": "Cook Rice",
      "description": "Start rice in the rice cooker",
      "task": "rice-cooker",
      "duration": {
       "type": "fixed",
       "seconds": 1200
      },
      "startTrigger": {
       "type": "programStart"
      }
     },
     {
      "stepId": "steam-vegetables",
      "name": "Steam Vegetables",
      "description": "Steam fresh vegetables",
      "task": "stovetop",
      "duration": {
       "type": "fixed",
       "seconds": 480
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "cook-rice"
      }
     }
    ]
   }
  ],
  "resourceConstraints": [
   {
    "task": "prep-work",
    "maxConcurrent": 2,
    "description": "Counter space for prep"
   },
   {
    "task": "stovetop",
    "maxConcurrent": 4,
    "description": "Stovetop burners"
   },
   {
    "task": "oven",
    "maxConcurrent": 1,
    "description": "Single oven"
   },
   {
    "task": "rice-cooker",
    "maxConcurrent": 1,
    "description": "Rice cooker"
   }
  ]
 },
 "replicates_comprehensive_demo": {
  "schemaVersion": "0.2.0",
  "programId": "replicates-comprehensive-demo",
  "name": "Comprehensive Replicates Demo",
  "description": "Demonstrates all three replication modes: parallel (simultaneous), serial (sequential), and stagger (delayed starts) at both track and step levels",
  "environmentType": "general",
  "resourceConstraints": [
   {
    "task": "processor",
    "maxConcurrent": 3,
    "description": "3 parallel processing units available"
   },
   {
    "task": "prep-work",
    "maxConcurrent": 2,
    "description": "2 prep stations available"
   },
   {
    "task": "packaging",
    "maxConcurrent": 1,
    "description": "Single packaging station"
   }
  ],
  "tracks": [
   {
    "trackId": "parallel-demo",
    "name": "Parallel Replicates Demo",
    "description": "Shows parallel execution - all replicates start at the same time",
    "steps": [
     {
      "stepId": "parallel-prep",
      "name": "Prep Work (Parallel)",
      "task": "prep-work",
      "description": "Prepare 3 items simultaneously - demonstrates parallel step replication",
      "duration": {
       "type": "fixed",
       "seconds": 120
      },
      "startTrigger": {
       "type": "programStart"
      },
      "replicates": {
       "count": 3,
       "mode": "parallel"
      }
     },
     {
      "stepId": "parallel-process",
      "name": "Process Items (Parallel)",
      "task": "processor",
      "description": "Process all 3 items at the same time using available processors",
      "duration": {
       "type": "fixed",
       "seconds": 180
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "parallel-prep"
      },
      "replicates": {
       "count": 3,
       "mode": "parallel"
      }
     }
    ]
   },
   {
    "trackId": "serial-demo",
    "name": "Serial Replicates Demo",
    "description": "Shows serial execution - replicates run one after another",
    "steps": [
     {
      "stepId": "serial-setup",
      "name": "Setup",
      "task": "prep-work",
      "description": "Initial setup for serial processing",
      "duration": {
       "type": "fixed",
       "seconds": 60
      },
      "startTrigger": {
       "type": "programStartOffset",
       "offsetSeconds": 60
      }
     },
     {
      "stepId": "serial-process",
      "name": "Process Batches (Serial)",
      "task": "processor",
      "description": "Process 4 batches sequentially - each batch waits for previous to complete",
      "duration": {
       "type": "fixed",
       "seconds": 90
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "serial-setup"
      },
      "replicates": {
       "count": 4,
       "mode": "serial"
      }
     },
     {
      "stepId": "serial-cleanup",
      "name": "Cleanup",
      "task": "prep-work",
      "description": "Clean up after serial processing",
      "duration": {
       "type": "fixed",
       "seconds": 30
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "serial-process"
      }
     }
    ]
   },
   {
    "trackId": "stagger-demo",
    "name": "Stagger Replicates Demo",
    "description": "Shows staggered execution - replicates start with delays between them",
    "steps": [
     {
      "stepId": "stagger-init",
      "name": "Initialize",
      "task": "prep-work",
      "description": "Initialize for staggered processing",
      "duration": {
       "type": "fixed",
       "seconds": 30
      },
      "startTrigger": {
       "type": "programStartOffset",
       "offsetSeconds": 120
      }
     },
     {
      "stepId": "stagger-process",
      "name": "Staggered Processing",
      "task": "processor",
      "description": "Process 5 items with 30-second delays between starts - demonstrates stagger mode",
      "duration": {
       "type": "fixed",
       "seconds": 150
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "stagger-init"
      },
      "replicates": {
       "count": 5,
       "mode": "stagger",
       "delay": 30
      }
     }
    ]
   },
   {
    "trackId": "packaging-final",
    "name": "Final Packaging",
    "description": "Collect all processed items and package them",
    "steps": [
     {
      "stepId": "collect-items",
      "name": "Collect All Items",
      "task": "packaging",
      "description": "Wait for all processing to complete, then collect items",
      "duration": {
       "type": "fixed",
       "seconds": 60
      },
      "startTrigger": {
       "logic": "all",
       "triggers": [
        {
         "type": "afterStep",
         "stepId": "parallel-process"
        },
        {
         "type": "afterStep",
         "stepId": "serial-cleanup"
        },
        {
         "type": "afterStep",
         "stepId": "stagger-process"
        }
       ]
      }
     },
     {
      "stepId": "final-package",
      "name": "Final Packaging",
      "task": "packaging",
      "description": "Package all items together",
      "duration": {
       "type": "fixed",
       "seconds": 90
      },
      "startTrigger": {
       "type": "afterStep",
       "stepId": "collect-items"
      }
     }
    ]
   }
  ]
 }
};
