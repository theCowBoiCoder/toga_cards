<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

class BootstrapAdmin extends Command
{
    protected $signature = 'toga:bootstrap-admin';

    protected $description = 'Create the first administrator without changing an existing account';

    public function handle(): int
    {
        if (! preg_match('/^[a-f0-9]{64}$/', (string) config('inventory.key'))) {
            $this->error('Configure ADMIN_SERVICE_KEY as 32 random hex-encoded bytes.');

            return self::FAILURE;
        }
        if (User::query()->exists()) {
            return self::SUCCESS;
        }
        $password = getenv('ADMIN_PASSWORD');
        if (! is_string($password) || strlen($password) < 12) {
            $this->error('Set a strong ADMIN_PASSWORD before creating the first administrator.');

            return self::FAILURE;
        }
        User::create(['name' => 'Toga Cards Admin', 'email' => config('inventory.admin_email'), 'password' => $password, 'is_admin' => true]);
        $this->info('Initial administrator created. Existing accounts are never reset on restart.');

        return self::SUCCESS;
    }
}
